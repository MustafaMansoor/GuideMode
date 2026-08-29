const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`file://${path.resolve(__dirname, 'index.html').replace(/\\/g, '/')}`);
  await page.waitForLoadState('domcontentloaded');

  const elements = await page.locator('button, a, input, select, textarea, [role]').evaluateAll(nodes => {
    const unique = [...new Set(nodes)];

    const implicitRole = element => {
      const tag = element.tagName.toLowerCase();
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag !== 'input') return null;
      const type = (element.type || 'text').toLowerCase();
      return ({
        button: 'button', checkbox: 'checkbox', color: 'textbox',
        email: 'textbox', number: 'spinbutton', radio: 'radio',
        range: 'slider', reset: 'button', search: 'searchbox',
        submit: 'button', tel: 'textbox', text: 'textbox', url: 'textbox'
      })[type] || null;
    };

    const textFromIds = ids => ids
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(' ');

    const accessibleName = element => {
      if (element.hasAttribute('aria-label')) return element.getAttribute('aria-label').trim();
      if (element.hasAttribute('aria-labelledby')) {
        const text = textFromIds(element.getAttribute('aria-labelledby'));
        if (text) return text;
      }
      if (element.labels?.length) {
        const text = [...element.labels].map(label => label.textContent.trim()).filter(Boolean).join(' ');
        if (text) return text;
      }
      if (element.tagName === 'IMG' && element.alt) return element.alt;
      if (element.getAttribute('title')) return element.getAttribute('title').trim();
      if (element.getAttribute('placeholder')) return element.getAttribute('placeholder').trim();
      return (element.textContent || element.value || '').replace(/\s+/g, ' ').trim() || null;
    };

    const context = element => {
      const fieldset = element.closest('fieldset');
      if (fieldset) {
        const legend = fieldset.querySelector(':scope > legend');
        if (legend) return legend.textContent.replace(/\s+/g, ' ').trim();
      }
      const landmark = element.closest('dialog, nav, header, footer, aside, form, article, section');
      if (!landmark) return 'document';
      const heading = landmark.querySelector('h1, h2, h3, h4, [aria-label]');
      const label = landmark.getAttribute('aria-label') || heading?.textContent?.replace(/\s+/g, ' ').trim();
      return label ? `${landmark.tagName.toLowerCase()}: ${label}` : landmark.tagName.toLowerCase();
    };

    return unique.map((element, index) => ({
      ref: `e${index + 1}`,
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      role: element.getAttribute('role') || implicitRole(element),
      name: accessibleName(element),
      value: 'value' in element ? element.value : null,
      checked: 'checked' in element ? element.checked : null,
      disabled: 'disabled' in element ? element.disabled : element.getAttribute('aria-disabled') === 'true',
      group_context: context(element)
    }));
  });

  console.log(JSON.stringify(elements, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
