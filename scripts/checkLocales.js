const assert = require('assert');
const path = require('path');

const localeDirectory = path.join(__dirname, '..', 'src', 'locales');
const english = require(path.join(localeDirectory, 'en.json'));
const simplifiedChinese = require(path.join(localeDirectory, 'zh-CN.json'));

assert.deepStrictEqual(
    Object.keys(simplifiedChinese).sort(),
    Object.keys(english).sort(),
    'English and Simplified Chinese locale keys must match.'
);

for (const [locale, messages] of Object.entries({ en: english, 'zh-CN': simplifiedChinese })) {
    for (const [key, value] of Object.entries(messages)) {
        assert.strictEqual(typeof value, 'string', `${locale}.${key} must be a string.`);
        assert.ok(value.trim(), `${locale}.${key} must not be empty.`);
    }
}

console.log(`${Object.keys(english).length} locale keys are aligned.`);
