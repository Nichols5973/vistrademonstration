import { decorateIcons } from '../../scripts/aem.js';
import { isAuthorEnvironment } from '../../scripts/scripts.js';
import {
  getLanguage, getSiteName, PATH_PREFIX, decorateIconTokens,
} from '../../scripts/utils.js';

/**
 * Fetches the footer fragment markup: the AEM-authored footer page first,
 * then the local preview fragment, then the site root fragment.
 * @param {string} authoredPath path of the authored footer page
 * @returns {Promise<{html: string, base: string}|null>} markup and its URL
 */
async function fetchFooter(authoredPath) {
  let resp = await fetch(new URL(`${authoredPath}.plain.html`, window.location));
  if (!resp.ok) resp = await fetch('/content/footer.plain.html');
  if (!resp.ok) resp = await fetch('/footer.plain.html');
  if (!resp.ok) return null;
  return { html: await resp.text(), base: resp.url };
}

/**
 * Resolves relative image paths (e.g. images/logo.svg) against the fragment URL.
 * @param {Element} container fragment root
 * @param {string} base URL the fragment was loaded from
 */
function rebaseImages(container, base) {
  container.querySelectorAll('img[src], source[srcset]').forEach((el) => {
    const attr = el.tagName === 'IMG' ? 'src' : 'srcset';
    const value = el.getAttribute(attr);
    if (value && !/^(\/|[a-z]+:|data:)/i.test(value)) {
      el.setAttribute(attr, new URL(value, base).pathname);
    }
  });
}

/**
 * Checks whether an element holds only images or icons (optionally inside a link).
 * @param {Element} el element to test
 * @returns {boolean}
 */
function isMediaOnly(el) {
  return !!el.querySelector('img, .icon') && !el.textContent.trim();
}

/**
 * Checks whether an element is a paragraph holding a single text link.
 * @param {Element} el element to test
 * @returns {boolean}
 */
function isLinkOnly(el) {
  const links = el.querySelectorAll('a');
  return el.tagName === 'P' && links.length === 1 && !isMediaOnly(el)
    && links[0].textContent.trim() === el.textContent.trim();
}

/**
 * Builds the top band: brand, link columns and a call-to-action column.
 * @param {Element} section authored section
 * @returns {Element} decorated band
 */
function buildMainBand(section) {
  const band = document.createElement('div');
  band.className = 'footer-main';
  let ctas = null;
  [...section.children].forEach((child) => {
    if (child.tagName === 'UL') {
      const column = document.createElement('div');
      column.className = 'footer-links';
      column.append(child);
      band.append(column);
      ctas = null;
    } else if (isLinkOnly(child)) {
      if (!ctas) {
        ctas = document.createElement('div');
        ctas.className = 'footer-ctas';
        band.append(ctas);
      }
      const link = child.querySelector('a');
      link.className = ctas.children.length ? 'footer-cta secondary' : 'footer-cta primary';
      ctas.append(link);
    } else if (isMediaOnly(child) && !band.children.length) {
      const brand = document.createElement('div');
      brand.className = 'footer-brand';
      brand.append(child);
      band.append(brand);
    } else {
      band.append(child);
    }
  });
  return band;
}

/**
 * Builds the bottom bar: social links, legal text and badges.
 * @param {Element} section authored section
 * @returns {Element} decorated bar
 */
function buildBottomBar(section) {
  const bar = document.createElement('div');
  bar.className = 'footer-bottom';
  const social = document.createElement('div');
  social.className = 'footer-social';
  const legal = document.createElement('div');
  legal.className = 'footer-legal';
  const badges = document.createElement('div');
  badges.className = 'footer-badges';

  [...section.children].forEach((child) => {
    if (isMediaOnly(child) && child.querySelector('a')) {
      child.querySelectorAll('a').forEach((link) => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        if (!link.getAttribute('aria-label')) {
          const iconName = link.querySelector('.icon')?.className.match(/icon-([a-z0-9-]+)/)?.[1];
          const label = link.title || link.querySelector('img')?.alt || iconName || '';
          link.setAttribute('aria-label', `${label} (opens in a new tab)`.trim());
        }
      });
      social.append(child);
    } else if (isMediaOnly(child)) {
      badges.append(child);
    } else {
      legal.append(child);
    }
  });

  bar.append(social, legal, badges);
  return bar;
}

/**
 * loads and decorates the footer
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  const langCode = getLanguage();
  let footerPath = `/${langCode}/footer`;
  if (isAuthorEnvironment()) {
    const siteName = await getSiteName();
    footerPath = `/content/${siteName}${PATH_PREFIX}/${langCode}/footer`;
  }

  const result = await fetchFooter(footerPath);
  block.textContent = '';
  if (!result) return;

  const fragment = document.createElement('div');
  fragment.innerHTML = result.html;
  rebaseImages(fragment, result.base);
  decorateIconTokens(fragment);

  const sections = [...fragment.children].filter((el) => el.tagName === 'DIV');
  const footer = document.createElement('div');
  footer.className = 'footer-inner';
  if (sections[0]) footer.append(buildMainBand(sections[0]));
  if (sections[1]) footer.append(buildBottomBar(sections[1]));
  sections.slice(2).forEach((section) => footer.append(section));

  decorateIcons(footer);
  block.append(footer);
}
