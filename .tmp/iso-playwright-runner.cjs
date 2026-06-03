const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const baseURL = 'http://localhost:3000';
const username = 'htho2000';
const password = '123456';
const maybePin = '123456';

const files = {
  main: path.resolve('cung_cap_dl/iso/NMCB-QT01_ Quy trình kiểm soát sản xuất.pdf'),
  auxReview: path.resolve('cung_cap_dl/iso/Mẫu đề nghị soát xét.pdf'),
  auxChange: path.resolve('cung_cap_dl/iso/PHK-OB25. MUC TIEU CONG TY 2025.pdf'),
};

const resultPath = path.resolve('.tmp/iso-playwright-results.json');

const results = {
  draftCases: [],
  reviewCase: null,
  pinAttempt: null,
  errors: [],
};

async function selectOptionByLabel(page, label, optionText) {
  await page.locator(`xpath=(//label[contains(normalize-space(.), "${label}")]/following-sibling::select[1] | //label[contains(normalize-space(.), "${label}")]//select[1])[1]`).selectOption({ label: optionText });
}

async function selectByPartialLabel(page, label, optionPart) {
  const select = page.locator(`xpath=(//label[contains(normalize-space(.), "${label}")]/following-sibling::select[1] | //label[contains(normalize-space(.), "${label}")]//select[1])[1]`);
  const options = await select.locator('option').allTextContents();
  const target = options.find((text) => text.includes(optionPart));
  if (!target) throw new Error(`Cannot find option "${optionPart}" for label "${label}"`);
  await select.selectOption({ label: target });
  return target;
}

function inputByLabel(page, label, index = 1) {
  return page.locator(`xpath=(//label[contains(normalize-space(.), "${label}")]/following-sibling::input[1] | //label[contains(normalize-space(.), "${label}")]//input[1])[${index}]`);
}

function textareaByLabel(page, label, index = 1) {
  return page.locator(`xpath=(//label[contains(normalize-space(.), "${label}")]/following-sibling::textarea[1] | //label[contains(normalize-space(.), "${label}")]//textarea[1])[${index}]`);
}

async function openStandardsAndChoose(page, standards) {
  await page.getByRole('button', { name: /chọn tiêu chuẩn/i }).click();
  for (const standard of standards) {
    await page.getByText(standard, { exact: false }).click();
  }
  await page.locator('body').click({ position: { x: 10, y: 10 } });
}

async function expectText(page, text, timeout = 20000) {
  await page.getByText(text).waitFor({ state: 'visible', timeout });
}

async function waitForVisibleText(page, text, timeout = 20000) {
  await page.locator(`text=${text}`).first().waitFor({ state: 'visible', timeout });
}

async function login(page) {
  await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
  if (page.url().includes('/dashboard')) return;
  const textInput = page.locator('input[placeholder="Tên đăng nhập *"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  try {
    await textInput.waitFor({ state: 'visible', timeout: 20000 });
  } catch (error) {
    results.errors.push(`login-debug url=${page.url()} body=${(await page.locator('body').innerText()).slice(0, 500)}`);
    throw error;
  }
  await textInput.fill(username);
  await passwordInput.fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).nth(1).click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

async function saveAndCapture(page) {
  await page.getByRole('button', { name: 'Lưu' }).click();
  await page.waitForURL(/\/dashboard\/iso\/documents\/(?!new-doc$)[^/]+$/, { timeout: 30000 });
  const url = page.url();
  const id = url.split('/').pop();
  return { id, url };
}

async function createDraftCase(page, { revision, soHieu, title }) {
  await page.goto(`${baseURL}/dashboard/iso/documents/new-doc`, { waitUntil: 'networkidle' });
  await openStandardsAndChoose(page, ['ISO 9001:2015']);
  await selectOptionByLabel(page, 'Phòng ban', 'NMCB');
  await selectByPartialLabel(page, 'Loại tài liệu', 'QT');
  await inputByLabel(page, 'Số hiệu').fill(String(soHieu));
  await page.getByPlaceholder('VD: 00 hoặc 01/01').fill(revision);
  await inputByLabel(page, 'Tên tài liệu').fill(title);
  await selectByPartialLabel(page, 'Người xem xét', 'Administrator');
  await selectByPartialLabel(page, 'Người phê duyệt', 'Tô Thành Luân');
  await page.locator('input[type="file"]').nth(0).setInputFiles(files.main);
  await waitForVisibleText(page, 'NMCB-QT01_ Quy trình kiểm soát sản xuất.pdf');
  const saved = await saveAndCapture(page);
  results.draftCases.push({ ...saved, revision, soHieu, title });
}

async function createParentReviewCase(page) {
  await page.goto(`${baseURL}/dashboard/iso/documents/new-doc`, { waitUntil: 'networkidle' });
  await selectOptionByLabel(page, 'Quy trình', 'Soát xét');
  await openStandardsAndChoose(page, ['ISO 9001:2015', 'ISO 14001:2015', 'PEFC ST 2002-1:2024']);
  await selectOptionByLabel(page, 'Phòng ban', 'NMCB');
  await selectByPartialLabel(page, 'Loại tài liệu', 'QT');
  await selectByPartialLabel(page, 'Mã tài liệu', 'NMCB-QT01');
  const lanSuaDoi = inputByLabel(page, 'Lần sửa đổi');
  await lanSuaDoi.waitFor({ state: 'visible', timeout: 10000 });
  const initialRevision = await lanSuaDoi.inputValue();
  await selectOptionByLabel(page, 'Thay đổi mã tài liệu', 'Có');
  await inputByLabel(page, 'Mã tài liệu mới').fill('NMCB-QT81');
  await inputByLabel(page, 'Tên tài liệu mới').fill('[TEST AUTO] Parent review NMCB-QT81');
  await textareaByLabel(page, 'Lý do soát xét').fill('Test luồng parent review tự động');
  await textareaByLabel(page, 'Nội dung soát xét').fill('Kiểm tra revision, hồ sơ con hiện có, hồ sơ con mới và 2 phiếu phụ');
  await selectByPartialLabel(page, 'Người xem xét', 'Administrator');
  await selectByPartialLabel(page, 'Người phê duyệt', 'Tô Thành Luân');

  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles(files.main);
  await waitForVisibleText(page, 'NMCB-QT01_ Quy trình kiểm soát sản xuất.pdf');
  await fileInputs.nth(2).setInputFiles(files.auxChange);
  await page.getByRole('button', { name: 'Thay file' }).nth(1).waitFor({ state: 'visible', timeout: 20000 });
  await fileInputs.nth(3).setInputFiles(files.auxReview);
  await page.getByRole('button', { name: 'Thay file' }).nth(2).waitFor({ state: 'visible', timeout: 20000 });

  const addButtons = page.getByRole('button', { name: 'Thêm hồ sơ' });
  await addButtons.nth(0).click();
  await selectByPartialLabel(page, 'Mã hồ sơ cũ', 'NMCB-QT01-F01');
  const childReviewRevision = page.getByPlaceholder('VD: 01 hoặc 01/01').last();
  const childReviewInitialRevision = await childReviewRevision.inputValue();
  await inputByLabel(page, 'Tên hồ sơ mới').fill('[TEST AUTO] F01 revised');
  await page.locator('label:has-text("File hồ sơ mới") input[type="file"]').setInputFiles(files.main);

  await addButtons.nth(1).click();
  const newCodeInput = page.getByDisplayValue('NMCB-QT81-F01');
  await newCodeInput.waitFor({ state: 'visible', timeout: 10000 });
  await selectOptionByLabel(page, 'Loại hồ sơ', 'PL - Phụ lục');
  await inputByLabel(page, 'Tên hồ sơ').last().fill('[TEST AUTO] New appendix child');
  await inputByLabel(page, 'Số hiệu').last().fill('99');
  await page.getByPlaceholder('VD: 00 hoặc 01/01').last().fill('00');
  await page.locator('label:has-text("File hồ sơ") input[type="file"]').last().setInputFiles(files.main);

  const auxLinksBeforeSave = await page.locator('a[href]').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute('href'))
      .filter((href) => href && /review|change|soat|yeu-cau/i.test(href))
  );

  const saved = await saveAndCapture(page);
  const auxLinksAfterSave = await page.locator('a[href]').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute('href'))
      .filter((href) => href && /review|change|soat|yeu-cau/i.test(href))
  );

  results.reviewCase = {
    ...saved,
    initialRevision,
    childReviewInitialRevision,
    childReviewExpected: 'NMCB-QT01-F01',
    childDraftExpectedPrefix: 'NMCB-QT81-',
    auxLinksBeforeSave,
    auxLinksAfterSave,
  };

  const sendButton = page.getByRole('button', { name: /Gửi xem xét|Gửi phê duyệt/ });
  if (await sendButton.isVisible()) {
    await sendButton.click();
    const pinField = page.locator('input[type="password"], input[type="text"]').last();
    await pinField.fill(maybePin);
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    try {
      const pinError = page.getByText(/PIN/i);
      await pinError.waitFor({ state: 'visible', timeout: 5000 });
      results.pinAttempt = { ok: false, message: await pinError.textContent() };
    } catch {
      results.pinAttempt = { ok: true };
    }
  }
}

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await login(page);
    await createDraftCase(page, { revision: '00', soHieu: 91, title: '[TEST AUTO] Draft revision 00' });
    await createDraftCase(page, { revision: '01', soHieu: 92, title: '[TEST AUTO] Draft revision 01' });
    await createDraftCase(page, { revision: '01/01', soHieu: 93, title: '[TEST AUTO] Draft revision 01/01' });
    await createParentReviewCase(page);
  } catch (error) {
    results.errors.push(String(error && error.stack ? error.stack : error));
    fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
    await browser.close();
    throw error;
  }
  fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
  await browser.close();
})();
