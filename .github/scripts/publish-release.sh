#!/usr/bin/env bash
set -Eeuo pipefail

tag="${1:?release tag is required}"
title="${2:?release title is required}"
notes_file="${3:?release notes file is required}"
release_kind="${4:?release kind is required}"
shift 4
assets=("$@")

repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
api_version="2026-03-10"
max_attempts=8

retry_delay() {
    local attempt="$1"
    local seconds=$((attempt * 3))
    if (( seconds > 15 )); then
        seconds=15
    fi
    echo "$seconds"
}

retry() {
    local attempt=1
    until "$@"; do
        if (( attempt >= max_attempts )); then
            echo "Command failed after ${max_attempts} attempts: $*" >&2
            return 1
        fi
        echo "GitHub API attempt ${attempt} failed; retrying..." >&2
        sleep "$(retry_delay "$attempt")"
        attempt=$((attempt + 1))
    done
}

for asset in "${assets[@]}"; do
    if [[ ! -f "$asset" ]]; then
        echo "Release asset does not exist: $asset" >&2
        exit 1
    fi
done

create_release() {
    local args=(
        release create "$tag"
        --verify-tag
        --title "$title"
        --notes-file "$notes_file"
    )

    if [[ "$release_kind" == "continuous" ]]; then
        args+=(--prerelease --latest=false)
    elif [[ "$release_kind" == "versioned" ]]; then
        args+=(--generate-notes --latest)
    else
        echo "Unsupported release kind: $release_kind" >&2
        return 1
    fi

    gh "${args[@]}"
}

update_release() {
    local args=(
        release edit "$tag"
        --title "$title"
        --notes-file "$notes_file"
    )

    if [[ "$release_kind" == "continuous" ]]; then
        args+=(--prerelease --latest=false)
    else
        args+=(--latest)
    fi

    gh "${args[@]}"
}

ensure_release() {
    local attempt=1
    while (( attempt <= max_attempts )); do
        if gh release view "$tag" >/dev/null 2>&1; then
            if update_release; then
                return 0
            fi
        elif create_release; then
            return 0
        fi

        if (( attempt < max_attempts )); then
            echo "Could not create or update release ${tag}; retrying..." >&2
            sleep "$(retry_delay "$attempt")"
        fi
        attempt=$((attempt + 1))
    done

    echo "Could not create or update release ${tag} after ${max_attempts} attempts" >&2
    return 1
}

remote_asset_metadata() {
    local name="$1"
    gh api \
        -H "X-GitHub-Api-Version: ${api_version}" \
        "repos/${repository}/releases/tags/${tag}" \
        --jq ".assets[] | select(.name == \"${name}\") | [.id, .state, .size, .digest] | @tsv"
}

delete_remote_asset() {
    local asset_id="$1"
    gh api \
        --method DELETE \
        -H "X-GitHub-Api-Version: ${api_version}" \
        "repos/${repository}/releases/assets/${asset_id}"
}

upload_asset() {
    local asset="$1"
    local name
    local expected_digest
    local expected_size
    local metadata
    local asset_id
    local state
    local remote_size
    local remote_digest
    local attempt=1

    name="$(basename "$asset")"
    expected_digest="sha256:$(sha256sum "$asset" | awk '{print $1}')"
    expected_size="$(stat --format='%s' "$asset")"

    while (( attempt <= max_attempts )); do
        if metadata="$(remote_asset_metadata "$name")"; then
            if [[ -n "$metadata" ]]; then
                IFS=$'\t' read -r \
                    asset_id state remote_size remote_digest <<<"$metadata"

                if [[ "$state" == "uploaded" &&
                      "$remote_size" == "$expected_size" &&
                      "$remote_digest" == "$expected_digest" ]]; then
                    echo "Verified release asset: ${name} (${expected_digest})"
                    return 0
                fi

                echo "Removing incomplete or outdated release asset: ${name}" >&2
                if ! delete_remote_asset "$asset_id"; then
                    echo "Could not remove ${name}; retrying..." >&2
                    sleep "$(retry_delay "$attempt")"
                    attempt=$((attempt + 1))
                    continue
                fi
            fi

            # Upload one file at a time. A 503 may still leave it stored; the
            # next iteration verifies its digest before deciding to retry.
            gh release upload "$tag" "$asset" || true
        fi

        if (( attempt < max_attempts )); then
            echo "Waiting to verify release asset ${name}..." >&2
            sleep "$(retry_delay "$attempt")"
        fi
        attempt=$((attempt + 1))
    done

    echo "Could not upload and verify release asset ${name}" >&2
    return 1
}

ensure_release
for asset in "${assets[@]}"; do
    upload_asset "$asset"
done
retry gh release view "$tag" --json url,tagName,assets
