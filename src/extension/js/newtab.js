(async () => {
  const { showCustomNewTab } = await chrome.storage.local.get("showCustomNewTab");
  if (showCustomNewTab !== true) {
    window.location.replace("chrome://newtab/");
    return;
  }

  const groups = [{"category":"Search engines","items":[["Google","https://www.google.com/search?q={q}"],["Google — verbatim","https://www.google.com/search?tbs=li:1&q={q}"],["Bing","https://www.bing.com/search?q={q}"],["DuckDuckGo","https://duckduckgo.com/?q={q}"],["Qwant","https://www.qwant.com/?q={q}"],["Mojeek","https://www.mojeek.com/search?q={q}"],["Startpage","https://www.startpage.com/sp/search?query={q}"],["Ecosia","https://www.ecosia.org/search?q={q}"],["Million Short","https://millionshort.com/search?remove=10000&keywords={q}"],["Million Short — non-commercial","https://millionshort.com/search?shopping=y&keywords={q}"]]},{"category":"Utilities","items":[["Wolfram|Alpha","https://www.wolframalpha.com/input/?i={q}"],["Google Translate","https://translate.google.com/?sl=auto&tl=en&text={q}&op=translate"],["Google Maps","https://www.google.com/maps/search/{q}"]]},{"category":"Reference","items":[["Wikipedia","https://en.wikipedia.org/w/index.php?title=Special:Search&fulltext=1&search={q}"],["Wikiwand","https://www.wikiwand.com/en/{q}?fullSearch=true"],["Britannica","https://www.britannica.com/search?query={q}"],["Credo Reference","https://search.credoreference.com/search/all?searchPhrase={q}"],["Oxford Reference","https://www.oxfordreference.com/search?q={q}"],["Scholastic GO!","https://go.scholastic.com/search.html?q={q}"]]},{"category":"Social and forums","items":[["Reddit","https://www.reddit.com/search?q={q}"],["LinkedIn","https://www.linkedin.com/search/results/all/?keywords={q}"],["Pinterest","https://www.pinterest.com/search/pins/?q={q}"],["Tumblr","https://www.tumblr.com/search/{q}"],["Google Groups","https://groups.google.com/g/{q}"],["BoardReader","https://boardreader.com/s/{q}.html"],["Social Searcher","https://www.social-searcher.com/social-buzz/?q5={q}"]]},{"category":"Questions and answers","items":[["Quora","https://www.quora.com/search?q={q}"],["StackExchange","https://stackexchange.com/search?q={q}"],["Brainly","https://brainly.com/app/ask?q={q}"],["Answers.com","https://www.answers.com/search?q={q}"]]},{"category":"Books","items":[["Google Books — free books","https://www.google.com/search?tbm=bks&tbs=bkv:f&q={q}"],["Google Books","https://www.google.com/search?tbm=bks&tbs=bkt:b&q={q}"],["HathiTrust","https://babel.hathitrust.org/cgi/ls?field1=ocr;q1={q};a=srchls"],["Internet Archive Books","https://archive.org/search.php?and[]=collection:%22texts%22&sin=TXT&query={q}"],["Open Library","https://openlibrary.org/search/inside?q={q}"],["Wikisource","https://en.wikisource.org/w/index.php?title=Special%3ASearch&search={q}"],["Archive of Our Own","https://archiveofourown.org/works/search?work_search%5Bquery%5D={q}"]]},{"category":"Documents and presentations","items":[["PDF Drive","https://www.pdfdrive.com/search?q={q}"],["Scribd","https://www.scribd.com/search?query={q}"],["Issuu","https://issuu.com/search?q={q}"],["edocr","https://www.edocr.com/search?q={q}"],["Google by document format","https://www.google.com/search?q={q}%20filetype%3Apdf%20OR%20filetype%3Adocx%20OR%20filetype%3Adoc%20OR%20filetype%3Aodt%20OR%20filetype%3Artf%20OR%20filetype%3Aps%20OR%20filetype%3Atex%20OR%20filetype%3Awpd"],["SlideShare","https://www.slideshare.net/search/slideshow?q={q}"],["Prezi","https://prezi.com/explore/search/?search={q}"],["Slides","https://slides.com/explore?search={q}"],["Google by presentation format","https://www.google.com/search?q={q}%20filetype%3Appt%20OR%20filetype%3Apptx%20OR%20filetype%3Apps%20OR%20filetype%3Appsx%20OR%20site%3Adocs.google.com%2Fpresentation%20OR%20site%3Aslideshare.net%20OR%20site%3Aspeakerdeck.com%20OR%20site%3Aslides.com%20OR%20filetype%3Aodp%20OR%20filetype%3Akey%20OR%20site%3Aprezi.com%20OR%20site%3Anoti.st"]]},{"category":"Academic search","items":[["Google Scholar","https://scholar.google.com/scholar?q={q}"],["The Lens","https://www.lens.org/lens/scholar/search/results?q={q}"],["Semantic Scholar","https://www.semanticscholar.org/search?q={q}"],["BASE","https://www.base-search.net/Search/Results?lookfor={q}"],["Scilit","https://www.scilit.net/articles/search?globalSearch={q}"],["ResearchGate","https://www.researchgate.net/search/publication?q={q}"],["Dimensions","https://app.dimensions.ai/discover/publication?search_text={q}"],["MyScienceWork","https://www.mysciencework.com/search/publications?query={q}"],["SHARE","https://share.osf.io/discover?q={q}"]]},{"category":"Open access academic","items":[["CORE","https://core.ac.uk/search?q={q}"],["Paperity","https://paperity.org/search/?q={q}"],["JURN","https://www.jurn.org/#gsc.q={q}"],["FreeFullPDF","https://www.freefullpdf.com/#gsc.q={q}"],["DOAJ","https://doaj.org/search/articles?source=%7B%22query%22%3A%7B%22query_string%22%3A%7B%22query%22%3A%22{q}%22%2C%22default_operator%22%3A%22AND%22%7D%7D%7D"]]},{"category":"Libraries and archives","items":[["WorldCat","https://www.worldcat.org/search?q={q}"],["ArchiveGrid","https://researchworks.oclc.org/archivegrid/?q={q}"],["Internet Archive","https://archive.org/search.php?sin=TXT&query={q}"],["Google Arts & Culture","https://artsandculture.google.com/search?q={q}"]]},{"category":"Databases and data","items":[["Google with database keywords","https://www.google.com/search?q={q}+database+OR+directory+OR+%22search+engine%22+OR+catalogue+OR+archive+OR+library+OR+warehouse+OR+repository"],["re3data.org","https://www.re3data.org/search?query={q}"],["DataCite","https://search.datacite.org/works?query={q}"],["Knoema","https://knoema.com/search?query={q}"],["Google Dataset Search","https://datasetsearch.research.google.com/search?query={q}"],["data.world","https://data.world/search?q={q}"],["Open Data Institute","https://certificates.theodi.org/en/datasets?search={q}"],["OpenDataSoft","https://data.opendatasoft.com/explore/?q={q}"],["Reddit r/datasets","https://www.reddit.com/r/datasets/search?restrict_sr=on&q={q}"],["Google with data keywords","https://www.google.com/search?q={q}%20data%20OR%20spreadsheet%20OR%20csv%20OR%20tsv%20OR%20json%20OR%20rdf%20OR%20xml"]]},{"category":"News search","items":[["Google News","https://news.google.com/search?q={q}"],["Yahoo News","https://news.search.yahoo.com/search?p={q}"],["Newslookup.com","https://newslookup.com/results?q={q}"],["Bing News","https://www.bing.com/news/search?q={q}"],["PressReader","https://www.pressreader.com/search?languages=en&groupBy=Language&hideSimilar=0&type=1&state=1&query={q}"],["WN.com","https://search.wn.com/?results_type=news&action=search&search_type=boolean&sort_type=relevance&search_string={q}"],["Factual News Search","https://factualsearch.news/#?fns.type=center-only&gsc.q={q}"]]},{"category":"Fact-checking","items":[["FNS fact-check sites","https://factualsearch.news/#?fns.type=fact-checking&gsc.q={q}"],["Snopes","https://www.snopes.com/?s={q}"],["TruthOrFiction.com","https://www.truthorfiction.com/?s={q}"],["Hoax-Slayer","https://www.hoax-slayer.net/?s={q}"]]},{"category":"Press releases","items":[["PRWeb","https://www.prweb.com/search.aspx?search-releases={q}"],["Business Wire","https://www.businesswire.com/portal/site/home/search/?searchType=news&searchPage=1&searchTerm={q}"],["ReleaseWire","https://www.releasewire.com/search/?q={q}"],["24-7 Press Release","https://www.24-7pressrelease.com/search_press_releases?match_type=L&keywords={q}"],["PR Newswire","https://www.prnewswire.com/search/news/?keyword={q}"]]},{"category":"Magazine articles","items":[["Google Books magazines","https://www.google.com/search?tbm=bks&tbs=bkt:m&q={q}"],["Internet Archive magazines","https://archive.org/search.php?and[]=collection:%22magazine_rack%22&sin=TXT&query={q}"],["Longform","https://longform.org/search?q={q}"],["Longreads","https://longreads.com/?s={q}"]]}];
  const grid = document.getElementById('tool-grid');
  const links = document.getElementById('category-links');
  const selectedName = document.getElementById('selected-name');
  const queryInput = document.getElementById('query');
  const form = document.getElementById('search-form');
  let selected;
  let defaultSearch = null;
  const defaultBtn = document.getElementById('default-btn');

  function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function setSelected(item, button) {
    selected = item;
    selectedName.textContent = item[0];
    document.querySelectorAll('.tool.active').forEach(el => el.classList.remove('active'));
    button.classList.add('active');

    if (defaultSearch && defaultSearch.name === item[0] && defaultSearch.url === item[1]) {
      defaultBtn.textContent = chrome.i18n.getMessage('newtabDefault') || '✓ Default';
      defaultBtn.disabled = true;
    } else {
      defaultBtn.textContent = chrome.i18n.getMessage('newtabSetDefault') || 'Set as default';
      defaultBtn.disabled = false;
    }

    queryInput.focus();
  }

  function buildUrl(template, query) {
    const encoded = encodeURIComponent(query);
    return template.replaceAll('{q}', encoded);
  }

  const toolEntries = [];

  groups.forEach((group, groupIndex) => {
    const id = slugify(group.category);
    const anchor = document.createElement('a');
    anchor.href = '#' + id;
    anchor.textContent = group.category;
    links.appendChild(anchor);

    const section = document.createElement('section');
    section.id = id;
    const heading = document.createElement('h2');
    heading.textContent = group.category;
    section.appendChild(heading);

    group.items.forEach((item, itemIndex) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool';
      button.textContent = item[0];
      button.title = item[0];
      button.addEventListener('click', () => setSelected(item, button));
      section.appendChild(button);
      toolEntries.push({ item, button });
    });
    grid.appendChild(section);
  });

  // Load saved default or fall back to first engine
  const stored = await chrome.storage.local.get('defaultSearch');
  if (stored.defaultSearch) {
    defaultSearch = stored.defaultSearch;
    const match = toolEntries.find(e =>
      e.item[0] === defaultSearch.name && e.item[1] === defaultSearch.url
    );
    if (match) {
      setSelected(match.item, match.button);
    } else {
      const first = toolEntries[0];
      setSelected(first.item, first.button);
    }
  } else {
    const first = toolEntries[0];
    setSelected(first.item, first.button);
  }

  defaultBtn.addEventListener('click', async () => {
    defaultSearch = { name: selected[0], url: selected[1] };
    await chrome.storage.local.set({ defaultSearch });
    defaultBtn.textContent = chrome.i18n.getMessage('newtabDefault') || '✓ Default';
    defaultBtn.disabled = true;
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const query = queryInput.value.trim();
    if (!query) {
      queryInput.focus();
      return;
    }
    const url = buildUrl(selected[1], query);
    window.location.href = url;
  });

  /* ── Google toolbar dropdowns ── */

  const FAVORITES = [
    { name: "Account", url: "https://myaccount.google.com/", y: -2088 },
    { name: "Search", url: "https://www.google.com/", y: -812 },
    { name: "Maps", url: "https://maps.google.com/", y: -2146 },
    { name: "YouTube", url: "https://www.youtube.com/", y: -1102 },
    { name: "Play", url: "https://play.google.com/", y: -1798 },
    { name: "News", url: "https://news.google.com/", y: -232 },
    { name: "Gmail", url: "https://mail.google.com/", y: -522 },
    { name: "Meet", url: "https://meet.google.com/", y: -1856 },
    { name: "Chat", url: "https://chat.google.com/", y: -2494 },
  ];

  const MORE_APPS = [
    { name: "Drive", url: "https://drive.google.com/", y: -2030 },
    { name: "Gemini", url: "https://gemini.google.com/", y: -1914 },
    { name: "Calendar", url: "https://calendar.google.com/", y: -1334 },
    { name: "Photos", url: "https://photos.google.com/", y: -1682 },
    { name: "Translate", url: "https://translate.google.com/", y: -986 },
    { name: "Vids", url: "https://docs.google.com/videos/create", y: -2958 },
    { name: "Sheets", url: "https://sheets.google.com/", y: -406 },
    { name: "Docs", url: "https://docs.google.com/", y: -2204 },
    { name: "Slides", url: "https://slides.google.com/", y: -2262 },
    { name: "Google One", url: "https://one.google.com/", y: -928 },
    { name: "Shopping", url: "https://shopping.google.com/", y: -2436 },
    { name: "Store", url: "https://store.google.com/", y: -1276 },
    { name: "Finance", url: "https://finance.google.com/", y: -580 },
    { name: "Keep", url: "https://keep.google.com/", y: -116 },
    { name: "Classroom", url: "https://classroom.google.com/", y: -638 },
    { name: "Earth", url: "https://earth.google.com/", y: -1624 },
    { name: "Travel", url: "https://www.google.com/travel/", y: -1044 },
    { name: "Books", url: "https://books.google.com/", y: -1392 },
    { name: "Wallet", url: "https://pay.google.com/", y: -1740 },
    { name: "Tasks", url: "https://tasks.google.com/", y: -696 },
  ];

  function addAppItem(grid, app) {
    const a = document.createElement("a");
    a.className = "gb-app-item";
    a.href = app.url;
    a.target = "_top";
    const icon = document.createElement("div");
    icon.className = "gb-app-icon";
    icon.style.backgroundPosition = `0 ${app.y}px`;
    const label = document.createElement("span");
    label.textContent = app.name;
    a.append(icon, label);
    grid.appendChild(a);
  }

  function buildAppsGrid() {
    const grid = document.getElementById("gb-apps-grid");
    grid.innerHTML = "";

    for (const app of FAVORITES) addAppItem(grid, app);

    if (MORE_APPS.length) {
      const hr = document.createElement("div");
      hr.className = "gb-section-divider";
      const heading = document.createElement("div");
      heading.className = "gb-section-header";
      heading.textContent = chrome.i18n.getMessage('newtabMoreFromGoogle') || "More from Google";
      grid.appendChild(hr);
      grid.appendChild(heading);

      for (const app of MORE_APPS) addAppItem(grid, app);
    }
  }

  function initDropdowns() {
    const backdrop = document.createElement("div");
    backdrop.className = "gb-backdrop";
    document.body.appendChild(backdrop);

    const appsTrigger = document.querySelector("#gbwa > .gb_C");
    const appsDropdown = document.getElementById("gb-apps-dropdown");

    function closeAll() {
      document.querySelectorAll(".gb-dropdown.open").forEach(d => d.classList.remove("open"));
      backdrop.classList.remove("shown");
    }

    function toggle(dropdown) {
      const isOpen = dropdown.classList.contains("open");
      closeAll();
      if (!isOpen) {
        dropdown.classList.add("open");
        backdrop.classList.add("shown");
      }
    }

    appsTrigger.addEventListener("click", e => {
      e.preventDefault();
      toggle(appsDropdown);
    });

    backdrop.addEventListener("click", closeAll);

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeAll();
    });
  }

  buildAppsGrid();
  initDropdowns();
})();
