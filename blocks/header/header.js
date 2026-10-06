import { getMetadata, decorateIcons } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';
import {
  getHostname, getLanguage, getSiteName, PATH_PREFIX, decorateIconTokens,
} from '../../scripts/utils.js';
import { isAuthorEnvironment } from '../../scripts/scripts.js';

const siteName = await getSiteName();

async function applyCFTheme(themeCFReference) {
  if (!themeCFReference) return;

  const CONFIG = {
    WRAPPER_SERVICE_URL: 'https://3635370-refdemoapigateway-stage.adobeioruntime.net/api/v1/web/ref-demo-api-gateway/fetch-cf',
    GRAPHQL_QUERY: '/graphql/execute.json/ref-demo-eds/BrandThemeByPath',
    EXCLUDED_THEME_KEYS: new Set(['brandSite', 'brandLogo']),
  };

  try {
    const decodedThemeCFReference = decodeURIComponent(themeCFReference);
    const hostnameFromPlaceholders = await getHostname();
    const hostname = hostnameFromPlaceholders || getMetadata('hostname');
    const aemauthorurl = getMetadata('authorurl') || '';
    const aempublishurl = hostname?.replace('author', 'publish')?.replace(/\/$/, '');
    const isAuthor = isAuthorEnvironment();

    // Prepare request configuration based on environment
    const requestConfig = isAuthor
      ? {
        url: `${aemauthorurl}${CONFIG.GRAPHQL_QUERY};path=${decodedThemeCFReference};ts=${Date.now()}`,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
      : {
        url: `${CONFIG.WRAPPER_SERVICE_URL}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphQLPath: `${aempublishurl}${CONFIG.GRAPHQL_QUERY}`,
          cfPath: decodedThemeCFReference,
          variation: `master;ts=${Date.now()}`,
        }),
      };

    // Fetch theme data
    const response = await fetch(requestConfig.url, {
      method: requestConfig.method,
      headers: requestConfig.headers,
      ...(requestConfig.body && { body: requestConfig.body }),
    });

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error(`HTTP error! status: ${response.status}`);
    }

    let themeCFRes;
    try {
      const responseText = await response.text();
      if (!responseText || responseText.trim() === '') {
        // eslint-disable-next-line no-console
        console.warn('Empty response received from server');
        return;
      }
      themeCFRes = JSON.parse(responseText);
    } catch (jsonError) {
      // eslint-disable-next-line no-console
      console.error('Error parsing JSON response:', jsonError);
    }
    const themeColors = themeCFRes?.data?.brandThemeByPath?.item;

    if (!themeColors) {
      // eslint-disable-next-line no-console
      console.warn('No theme data found in the response');
      return;
    }

    // Apply theme colors to CSS variables
    const cssVariables = Object.entries(themeColors)
      .filter(([key, value]) => value != null && !CONFIG.EXCLUDED_THEME_KEYS.has(key))
      .map(([key, value]) => `  --brand-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`)
      .join('\n');

    if (cssVariables) {
      const styleElement = document.createElement('style');
      styleElement.textContent = `:root {\n${cssVariables}\n}`;
      document.head.appendChild(styleElement);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error applying theme:', error);
  }
}

/**
 * Resolves the home link for the logo (author content path or published root).
 * @param {string} langCode current language
 * @returns {string} href for the logo
 */
function getHomeLink(langCode) {
  const aueResource = document.body.getAttribute('data-aue-resource')
    ?.replace(new RegExp(`^.*?(\\/content.*?\\/${langCode}).*$`), '$1');
  if (aueResource) return `${aueResource}.html`;
  return langCode === 'en' ? window.location.origin : `${window.location.origin}/${langCode}`;
}

/**
 * Loads the nav fragment: the AEM-authored nav first, then the local
 * preview fragment (/content/nav.plain.html), then the site root fragment.
 * @param {string} navPath authored nav path
 * @returns {Promise<HTMLElement|null>} fragment root
 */
async function loadNav(navPath) {
  const candidates = [navPath, '/content/nav', '/nav'];
  for (let i = 0; i < candidates.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const fragment = await loadFragment(candidates[i]);
    if (fragment && fragment.querySelector('.section')) {
      return { fragment, path: candidates[i] };
    }
  }
  return { fragment: null, path: navPath };
}

/**
 * Rebases relative image paths (e.g. images/logo.svg) to the fragment location.
 * @param {Element} nav nav element
 * @param {string} fragmentPath path the fragment was loaded from
 */
function rebaseImages(nav, fragmentPath) {
  const base = new URL(fragmentPath, window.location);
  nav.querySelectorAll('img[src], source[srcset]').forEach((el) => {
    const attr = el.tagName === 'IMG' ? 'src' : 'srcset';
    const value = el.getAttribute(attr);
    if (value && !/^(\/|[a-z]+:|data:|\.\/media_)/i.test(value)) {
      el.setAttribute(attr, new URL(value, base).pathname);
    }
  });
}

/**
 * Removes default button decoration from nav links.
 * @param {Element} nav nav element
 */
function stripButtons(nav) {
  nav.querySelectorAll('.button').forEach((btn) => btn.classList.remove('button', 'primary', 'secondary'));
  nav.querySelectorAll('.button-container').forEach((p) => p.classList.remove('button-container'));
}

/**
 * Unwraps a bold wrapper around (or inside) a link.
 * @param {Element} link link element
 * @returns {boolean} whether the link was bold
 */
function unwrapStrong(link) {
  const strong = link.querySelector('strong') || link.closest('strong');
  if (!strong) return false;
  if (link.contains(strong)) strong.replaceWith(...strong.childNodes);
  else strong.replaceWith(link);
  return true;
}

/**
 * Decorates the tools section: a bold link becomes the call-to-action
 * button, other links are plain tool links.
 * @param {Element} navTools tools section
 */
function decorateTools(navTools) {
  navTools.querySelectorAll('a').forEach((link) => {
    link.classList.add(unwrapStrong(link) ? 'nav-cta' : 'nav-tool-link');
  });
}

/**
 * Turns a utility link into a search toggle that reveals an inline search
 * form. The link target is used as the search page, its label as placeholder.
 * @param {Element} link authored search link
 */
function buildSearch(link) {
  const item = link.closest('li') || link.parentElement;
  const label = link.textContent.trim() || 'Search';
  item.classList.add('nav-search');

  const form = document.createElement('form');
  form.className = 'nav-search-form';
  form.action = link.href;
  form.method = 'get';
  form.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.type = 'search';
  input.name = 'query';
  input.placeholder = label;
  input.setAttribute('aria-label', label);
  form.append(input);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'nav-search-close';
  close.setAttribute('aria-label', `Close ${label.toLowerCase()}`);
  close.innerHTML = '<span class="icon icon-xmark"></span>';
  item.append(form, close);

  const setOpen = (open) => {
    item.classList.toggle('is-open', open);
    link.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) input.focus();
  };
  link.setAttribute('role', 'button');
  link.setAttribute('aria-expanded', 'false');
  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (item.classList.contains('is-open') && input.value.trim()) form.requestSubmit();
    else setOpen(!item.classList.contains('is-open'));
  });
  close.addEventListener('click', () => {
    input.value = '';
    setOpen(false);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
}

/**
 * Decorates the utility bar: the first list holds audience links (a bold
 * link marks the current one), the second holds utility links such as
 * search, phone and language.
 * @param {Element} navUtility utility section
 */
function decorateUtility(navUtility) {
  navUtility.querySelectorAll(':scope .default-content-wrapper > ul').forEach((list, i) => {
    list.classList.add(i === 0 ? 'nav-utility-left' : 'nav-utility-right');
  });
  navUtility.querySelectorAll('a').forEach((link) => {
    if (unwrapStrong(link)) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
  const searchLink = navUtility.querySelector('a .icon-magnifier')?.closest('a');
  if (searchLink) buildSearch(searchLink);
}

/**
 * Closes all open nav dropdowns.
 * @param {Element} navSections sections element
 */
function closeMenus(navSections) {
  navSections.querySelectorAll('.nav-drop-toggle[aria-expanded="true"]').forEach((toggle) => {
    toggle.setAttribute('aria-expanded', 'false');
  });
}

/**
 * Decorates authored menu lists in the nav sections as a horizontal menu.
 * Items with a nested list become dropdowns (hover, focus or click to open).
 * @param {Element} navSections sections element
 */
function decorateMenus(navSections) {
  const menus = navSections.querySelectorAll(':scope .default-content-wrapper > ul');
  if (!menus.length) return;

  menus.forEach((menu) => {
    menu.classList.add('nav-menu');
    [...menu.children].forEach((item) => {
      const submenu = item.querySelector(':scope > ul');
      if (!submenu) return;
      item.classList.add('nav-drop');
      submenu.classList.add('nav-submenu');

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nav-drop-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      const link = item.querySelector(':scope > a, :scope > p > a');
      if (link) {
        toggle.setAttribute('aria-label', `${link.textContent.trim()} menu`);
        item.insertBefore(toggle, submenu);
      } else {
        const labelNodes = [...item.childNodes].filter((node) => node !== submenu);
        toggle.textContent = labelNodes.map((node) => node.textContent).join(' ').trim();
        labelNodes.forEach((node) => node.remove());
        item.prepend(toggle);
      }

      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        closeMenus(navSections);
        toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      });
    });
  });

  document.addEventListener('click', (e) => {
    if (!navSections.contains(e.target)) closeMenus(navSections);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus(navSections);
  });
}

/**
 * loads and decorates the header, mainly the nav
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  applyCFTheme(getMetadata('theme_cf_reference'));

  const navMeta = getMetadata('nav');
  const langCode = getLanguage();
  let navPath = `/${langCode}/nav`;
  if (isAuthorEnvironment()) {
    navPath = navMeta ? new URL(navMeta, window.location).pathname : `/content/${siteName}${PATH_PREFIX}/${langCode}/nav`;
  }

  const { fragment, path } = await loadNav(navPath);

  // decorate nav DOM
  block.textContent = '';
  const nav = document.createElement('nav');
  nav.id = 'nav';
  nav.setAttribute('aria-label', 'Main');
  while (fragment && fragment.firstElementChild) nav.append(fragment.firstElementChild);

  // the logo section is the brand; sections before it form the utility bar,
  // the first section after it holds the menus, the rest are tools
  const navSectionEls = [...nav.children];
  const brandIndex = Math.max(0, navSectionEls.findIndex((section) => section.querySelector('img, picture') && !section.querySelector('ul')));
  navSectionEls.forEach((section, i) => {
    let name = 'tools';
    if (i < brandIndex) name = 'utility';
    else if (i === brandIndex) name = 'brand';
    else if (i === brandIndex + 1) name = 'sections';
    section.classList.add(`nav-${name}`);
  });

  rebaseImages(nav, path);
  stripButtons(nav);
  decorateIconTokens(nav);
  const navUtility = nav.querySelector('.nav-utility');
  if (navUtility) decorateUtility(navUtility);
  decorateIcons(nav);
  nav.querySelectorAll('.icon img').forEach((icon) => { icon.loading = 'eager'; });

  const navBrand = nav.querySelector('.nav-brand');
  const logo = navBrand?.querySelector('picture, img');
  if (logo && !logo.closest('a')) {
    const img = logo.tagName === 'IMG' ? logo : logo.querySelector('img');
    const anchor = document.createElement('a');
    anchor.href = getHomeLink(langCode);
    anchor.setAttribute('aria-label', img?.alt || 'Home');
    logo.replaceWith(anchor);
    anchor.append(logo);
  }

  const navSections = nav.querySelector('.nav-sections');
  if (navSections) decorateMenus(navSections);

  const navTools = nav.querySelector('.nav-tools');
  if (navTools) decorateTools(navTools);

  const hamburger = document.createElement('button');
  hamburger.type = 'button';
  hamburger.className = 'nav-hamburger';
  hamburger.setAttribute('aria-controls', 'nav');
  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.setAttribute('aria-label', 'Open navigation');
  hamburger.innerHTML = '<span class="nav-hamburger-icon"></span>';
  const setExpanded = (expanded) => {
    nav.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    hamburger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    hamburger.setAttribute('aria-label', expanded ? 'Close navigation' : 'Open navigation');
  };
  hamburger.addEventListener('click', () => setExpanded(nav.getAttribute('aria-expanded') !== 'true'));
  setExpanded(false);
  nav.append(hamburger);

  // reset open menus when crossing the desktop breakpoint
  window.matchMedia('(width >= 900px)').addEventListener('change', () => {
    setExpanded(false);
    if (navSections) closeMenus(navSections);
  });

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  if (navUtility) navWrapper.append(navUtility);
  navWrapper.append(nav);
  block.append(navWrapper);
}
