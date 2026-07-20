#!/usr/bin/env bash
set -Eeuo pipefail

tag="${1:?release tag is required}"
title="${2:?release title is required}"
notes_file="${3:?release notes file is required}"
release_kind="${4:?release kind is required}"
shift 4
assets=("$@")

max_attempts=5

retry() {
    local attempt=1
    until "$@"; do
        if (( attempt >= max_attempts )); then
            echo "Command failed after ${max_attempts} attempts: $*" >&2
            return 1
        fi
        echo "GitHub API attempt ${attempt} failed; retrying..." >&2
        sleep $((attempt * 5))
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
            sleep $((attempt * 5))
        fi
        attempt=$((attempt + 1))
    done

    echo "Could not create or update release ${tag} after ${max_attempts} attempts" >&2
    return 1
}

ensure_release
retry gh release upload "$tag" "${assets[@]}" --clobber
retry gh release view "$tag" --json url,tagName,assets
