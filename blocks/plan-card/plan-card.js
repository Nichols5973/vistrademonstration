/* eslint-disable no-underscore-dangle */ // AEM GraphQL fields (_authorUrl, _path, ...)
import { getMetadata } from '../../scripts/aem.js';
import { isAuthorEnvironment } from '../../scripts/scripts.js';
import { getHostname, mapAemPathToSitePath } from '../../scripts/utils.js';

const CONFIG = {
  WRAPPER_SERVICE_URL: 'https://3635370-refdemoapigateway-stage.adobeioruntime.net/api/v1/web/ref-demo-api-gateway/fetch-cf',
  GRAPHQL_QUERY: '/graphql/execute.json/ref-demo-eds/PlanCardByPath',
  RESPONSE_KEY: 'planCardByPath',
};

/**
 * Escapes text for safe use in HTML.
 * @param {string} value raw text
 * @returns {string} escaped text
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolves a content fragment link field (string path/URL or content reference object).
 * @param {string|object} field link field value
 * @param {object} env environment details
 * @returns {Promise<string>} href, or empty string when not set
 */
async function resolveLink(field, { isAuthor, authorUrl, publishUrl }) {
  if (!field) return '';
  let href = '';
  if (typeof field === 'string') {
    href = /^(https?:|tel:|mailto:|#)/i.test(field)
      ? field
      : `${isAuthor ? authorUrl : ''}${field}`;
  } else if (typeof field === 'object') {
    if (isAuthor) {
      href = field._authorUrl || (field._path ? `${authorUrl}${field._path}` : '');
    } else {
      href = field._path || field._publishUrl || '';
    }
  }

  // map AEM content paths to site paths on publish/EDS
  if (!isAuthor && href) {
    try {
      const candidate = /^https?:\/\//i.test(href) && publishUrl && href.startsWith(publishUrl)
        ? new URL(href).pathname
        : href;
      if (candidate.startsWith('/content/')) {
        const mapped = await mapAemPathToSitePath(candidate);
        if (mapped) href = mapped;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('plan-card: failed to map link via paths.json', e);
    }
  }
  return href;
}

/**
 * Splits a rate like "18.4¢" into its number and unit (defaults to ¢).
 * @param {string} rate authored rate
 * @returns {{ value: string, unit: string }}
 */
function splitRate(rate) {
  const match = String(rate).trim().match(/^([\d.,]+)\s*(.*)$/);
  if (!match) return { value: String(rate).trim(), unit: '' };
  return { value: match[1], unit: match[2] || '¢' };
}

/**
 * Fetches the plan card content fragment (author: AEM GraphQL; publish: wrapper service).
 */
async function fetchPlanCard(contentPath, variation, env) {
  const request = env.isAuthor
    ? {
      url: `${env.authorUrl}${CONFIG.GRAPHQL_QUERY};path=${contentPath};variation=${variation};ts=${Date.now()}`,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }
    : {
      url: CONFIG.WRAPPER_SERVICE_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphQLPath: `${env.publishUrl}${CONFIG.GRAPHQL_QUERY}`,
        cfPath: contentPath,
        variation: `${variation};ts=${Date.now()}`,
      }),
    };

  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body && { body: request.body }),
  });
  if (!response.ok) throw new Error(`plan card request failed: ${response.status}`);
  const json = await response.json();
  return json?.data?.[CONFIG.RESPONSE_KEY]?.item;
}

/**
 * Builds the plan card markup from content fragment data.
 */
async function renderCard(cf, itemId, variation, env) {
  const prop = (name, label, type = 'text') => `data-aue-prop="${name}" data-aue-label="${label}" data-aue-type="${type}"`;
  // in the author environment, empty fields render as placeholders so they can be
  // filled in Universal Editor (hidden outside edit mode via CSS)
  const showEmpty = env.isAuthor;
  const placeholder = (text) => `<span class="plan-card-placeholder-text">${text}</span>`;
  const empty = (value) => (showEmpty && !value ? ' plan-card-placeholder' : '');

  const description = cf.description?.html || (cf.description?.plaintext ? `<p>${escapeHtml(cf.description.plaintext)}</p>` : '');
  const { value: rateValue, unit: rateUnit } = cf.rate ? splitRate(cf.rate) : {};
  const [buttonHref, detailsHref] = await Promise.all([
    resolveLink(cf.buttonLink, env),
    resolveLink(cf.planDetailsLink, env),
  ]);
  const phone = cf.phoneNumber ? String(cf.phoneNumber).trim() : '';
  const phoneHref = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : '';
  const detailsLabel = cf.planDetailsLabel || 'See Plan Details';
  const hasPricing = rateValue || cf.rateDescription || cf.term || showEmpty;
  const hasFooter = detailsHref || phone || showEmpty;

  const header = cf.header || showEmpty
    ? `<p class="plan-card-header${empty(cf.header)}" ${prop('header', 'Header')}>${cf.header ? escapeHtml(cf.header) : placeholder('Add header')}</p>` : '';
  const title = cf.title || showEmpty
    ? `<h3 class="plan-card-title${empty(cf.title)}" ${prop('title', 'Title')}>${cf.title ? escapeHtml(cf.title) : placeholder('Add title')}</h3>` : '';
  const desc = description || showEmpty
    ? `<div class="plan-card-description${empty(description)}" ${prop('description', 'Description', 'richtext')}>${description || `<p>${placeholder('Add description')}</p>`}</div>` : '';
  const rate = rateValue || showEmpty
    ? `<p class="plan-card-rate${empty(rateValue)}" ${prop('rate', 'Rate')}>${rateValue
      ? `<span class="plan-card-rate-value">${escapeHtml(rateValue)}</span><span class="plan-card-rate-unit">${escapeHtml(rateUnit)}</span>`
      : placeholder('Add rate')}</p>` : '';
  const rateDescription = cf.rateDescription || showEmpty
    ? `<p class="plan-card-rate-description${empty(cf.rateDescription)}" ${prop('rateDescription', 'Rate Description')}>${cf.rateDescription ? escapeHtml(cf.rateDescription) : placeholder('Add rate description')}</p>` : '';
  const term = cf.term || showEmpty
    ? `<p class="plan-card-term${empty(cf.term)}" ${prop('term', 'Term')}>${cf.term ? escapeHtml(cf.term) : placeholder('Add term')}</p>` : '';
  const promotion = cf.promotion || showEmpty
    ? `<p class="plan-card-promotion${empty(cf.promotion)}" ${prop('promotion', 'Promotion')}>${cf.promotion ? escapeHtml(cf.promotion) : placeholder('Add promotion')}</p>` : '';
  const button = cf.buttonLabel || showEmpty
    ? `<p class="plan-card-cta${empty(cf.buttonLabel)}"><a class="plan-card-button" href="${escapeHtml(buttonHref || '#')}" ${prop('buttonLink', 'Button Link', 'reference')} data-aue-filter="page"><span ${prop('buttonLabel', 'Button Label')}>${cf.buttonLabel ? escapeHtml(cf.buttonLabel) : 'Add button label'}</span></a></p>` : '';
  const details = detailsHref || showEmpty
    ? `<a class="plan-card-details${empty(detailsHref)}" href="${escapeHtml(detailsHref || '#')}" ${prop('planDetailsLink', 'Plan Details Link', 'reference')} data-aue-filter="page"><span ${prop('planDetailsLabel', 'Plan Details Label')}>${detailsHref ? escapeHtml(detailsLabel) : 'Add plan details link'}</span></a>` : '';
  const phoneLink = phone || showEmpty
    ? `<a class="plan-card-phone${empty(phone)}" href="${escapeHtml(phoneHref || '#')}" ${prop('phoneNumber', 'Phone Number')}><span class="plan-card-phone-icon" aria-hidden="true"></span>${phone ? escapeHtml(phone) : 'Add phone number'}</a>` : '';

  return `<article class="plan-card-item" data-aue-resource="${itemId}" data-aue-label="${escapeHtml(variation)}" data-aue-type="reference" data-aue-filter="contentfragment">
    ${header}
    <div class="plan-card-body">
      ${title}
      ${desc}
      ${hasPricing ? `<div class="plan-card-pricing">${rate}${rateDescription}${term}</div>` : ''}
      ${promotion}
      ${button}
    </div>
    ${hasFooter ? `<div class="plan-card-footer">${details}${phoneLink}</div>` : ''}
  </article>`;
}

/**
 * Plan Card: renders a "Plan Card" content fragment (with variation support).
 * @param {Element} block
 */
export default async function decorate(block) {
  const contentPath = block.querySelector(':scope > div:nth-child(1) a')?.textContent?.trim()
    || block.querySelector(':scope > div:nth-child(1) > div')?.textContent?.trim();
  const variation = block.querySelector(':scope > div:nth-child(2) > div')?.textContent?.trim()
    ?.toLowerCase()
    ?.replace(/\s+/g, '_') || 'master';

  const hostname = (await getHostname()) || getMetadata('hostname');
  const env = {
    isAuthor: isAuthorEnvironment(),
    authorUrl: getMetadata('authorurl') || '',
    publishUrl: hostname?.replace('author', 'publish')?.replace(/\/$/, '') || '',
  };

  block.textContent = '';
  if (!contentPath) return;

  try {
    const cf = await fetchPlanCard(contentPath, variation, env);
    if (!cf) {
      // eslint-disable-next-line no-console
      console.error('plan-card: no content fragment data found', { contentPath, variation });
      return;
    }
    const itemId = `urn:aemconnection:${contentPath}/jcr:content/data/${variation}`;
    block.setAttribute('data-aue-type', 'container');
    block.innerHTML = await renderCard(cf, itemId, variation, env);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('plan-card: error rendering content fragment', {
      error: error.message, contentPath, variation, isAuthor: env.isAuthor,
    });
    block.textContent = '';
  }
}
