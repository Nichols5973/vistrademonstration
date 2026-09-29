import { getMetadata, decorateIcons } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';
import {
  getHostname, getLanguage, getSiteName, PATH_PREFIX,
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
 * Converts :icon-name: tokens left in text (e.g. rich text authored in AEM)
 * into EDS icon spans.
 * @param {Element} container element to scan
 */
function decorateIconTokens(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    if (/:[a-z0-9-]+:/.test(walker.currentNode.nodeValue)) textNodes.push(walker.currentNode);
  }
  textNodes.forEach((node) => {
    const frag = document.createDocumentFragment();
    node.nodeValue.split(/(:[a-z0-9-]+:)/).forEach((part) => {
      const match = part.match(/^:([a-z0-9-]+):$/);
      if (match) {
        const span = document.createElement('span');
        span.className = `icon icon-${match[1]}`;
        frag.append(span);
      } else if (part.trim()) {
        frag.append(document.createTextNode(part));
      } else if (part && frag.lastChild) {
        frag.append(document.createTextNode(' '));
      }
    });
    node.replaceWith(frag);
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
 * Decorates call-to-action links in nav tools. A label written as
 * "Short: detail" shows the short label on small screens and the full label
 * on wider screens.
 * @param {Element} navTools tools section
 */
function decorateTools(navTools) {
  navTools.querySelectorAll('a').forEach((link) => {
    link.classList.add('nav-cta');
    // icons authored next to the link (same paragraph) belong inside the button
    const siblingIcons = [...(link.parentElement?.children || [])]
      .filter((el) => el !== link && el.classList.contains('icon'));
    link.prepend(...siblingIcons);
    const label = link.textContent.trim();
    const sep = label.indexOf(':');
    const icons = [...link.querySelectorAll('.icon')];
    link.textContent = '';
    link.append(...icons);
    if (sep > 0) {
      const short = document.createElement('span');
      short.className = 'nav-cta-short';
      short.textContent = label.slice(0, sep).trim();
      const full = document.createElement('span');
      full.className = 'nav-cta-full';
      full.textContent = label;
      link.append(short, full);
    } else {
      const text = document.createElement('span');
      text.textContent = label;
      link.append(text);
    }
    link.title = label;
    if (!link.getAttribute('aria-label')) link.setAttribute('aria-label', label);
  });
}

/**
 * Marks paragraphs in the nav sections that contain only icons (e.g. a star rating).
 * @param {Element} navSections sections element
 */
function decorateSections(navSections) {
  navSections.querySelectorAll('p').forEach((p) => {
    if (p.querySelector('.icon') && !p.textContent.trim()) p.classList.add('nav-icon-group');
  });
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

  ['brand', 'sections', 'tools'].forEach((c, i) => {
    const section = nav.children[i];
    if (section) section.classList.add(`nav-${c}`);
  });

  rebaseImages(nav, path);
  stripButtons(nav);
  decorateIconTokens(nav);
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
  if (navSections) {
    decorateSections(navSections);
    decorateMenus(navSections);
  }

  const navTools = nav.querySelector('.nav-tools');
  if (navTools) decorateTools(navTools);

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);
}
