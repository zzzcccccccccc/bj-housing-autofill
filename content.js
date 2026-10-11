"use strict";

// This script runs only after the user clicks the extension. It never submits the form.
if (!globalThis.__monthlyHousingFormHelperInstalled) {
  globalThis.__monthlyHousingFormHelperInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CHECK_APPLICATION") {
      sendResponse({ ok: isExpectedApplication() });
      return;
    }
    if (message?.type === "FILL_APPLICATION") {
      fillApplication(message.profile).then(
        items => sendResponse({ items }),
        error => sendResponse({ items: [{ key: "页面", status: "manual", reason: error.message || String(error) }] })
      );
      return true;
    }
    if (message?.type === "CONFIRM_DECLARATION") {
      sendResponse(checkDeclaration());
      return;
    }
  });
}

function isExpectedApplication() {
  if (location.protocol !== "https:" || location.hostname !== "zhengce.beijing.gov.cn") return false;
  if (!document.body.innerText.includes("2026年海淀区青年人才安居补贴（申请人）")) return false;
  const labels = new Set([...document.querySelectorAll("tr > td")]
    .map(cell => String(cell.innerText || "").replace(/\s+/g, "")));
  return ["姓名", "学历", "是否已婚", "是否有子女"].every(label => labels.has(label)) &&
    document.querySelectorAll("input:not([type=hidden])").length >= 8;
}

async function fillApplication(profile) {
  if (!isExpectedApplication()) {
    throw new Error("当前页面不是对应的申请表，未填写任何内容。");
  }

  const items = [];
  const add = (key, success, reason = "页面控件未找到或未能确认写入") => {
    items.push({ key, status: success ? "done" : "manual", reason: success ? "" : reason });
  };
  const text = value => String(value ?? "").trim().replace(/\s+/g, "");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isVisible = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");

  function findRow(label) {
    return [...document.querySelectorAll("tr")].find(row =>
      [...row.children].some(cell => text(cell.innerText) === label));
  }

  function valueCell(label) {
    const row = findRow(label);
    if (!row) return null;
    const cell = [...row.children].find(td => text(td.innerText) === label);
    return cell?.nextElementSibling || null;
  }

  function topInput(label) {
    const matches = [...document.querySelectorAll("div, span, label, td")]
      .filter(el => isVisible(el) && text(el.innerText) === `${label}：` &&
        ![...el.children].some(child => text(child.innerText) === `${label}：`));
    for (const el of matches) {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        for (let sibling = node.nextElementSibling, n = 0; sibling && n < 2; sibling = sibling.nextElementSibling, n++) {
          const input = sibling.matches("input:not([type=hidden])") ? sibling : sibling.querySelector("input:not([type=hidden])");
          if (input && isVisible(input)) return input;
          if (sibling.querySelectorAll("input:not([type=hidden])").length > 1) break;
        }
      }
    }
    return null;
  }

  function setInput(input, value) {
    if (!input || !isVisible(input) || input.disabled) return false;
    if (input.readOnly && !input.classList.contains("el-input__inner")) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    input.focus();
    setter?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
    return input.value === value;
  }

  function sameDate(actual, expected) {
    const match = String(actual || "").match(/(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
    if (!match) return false;
    const month = `${match[1]}-${match[2].padStart(2, "0")}`;
    return expected.length === 7 ? month === expected
      : !!match[3] && `${month}-${match[3].padStart(2, "0")}` === expected;
  }

  async function pickElementDate(input, value) {
    const [year, month, day] = value.split("-").map(Number);
    input.click();
    await sleep(120);
    const panel = [...document.querySelectorAll(".el-picker-panel")].find(isVisible);
    if (!panel) return false;
    const yearLabel = panel.querySelector(".el-date-picker__header-label");
    if (!yearLabel) return false;
    yearLabel.click();
    await sleep(80);
    for (let attempt = 0; attempt < 12; attempt++) {
      const years = [...panel.querySelectorAll(".el-year-table td")].filter(isVisible);
      const target = years.find(cell => Number(text(cell.innerText).match(/\d{4}/)?.[0]) === year && !cell.classList.contains("disabled"));
      if (target) { target.click(); break; }
      const values = years.map(cell => Number(text(cell.innerText).match(/\d{4}/)?.[0])).filter(Number.isFinite);
      if (!values.length) return false;
      const backwards = year < Math.min(...values);
      const forwards = year > Math.max(...values);
      if (!backwards && !forwards) return false;
      const arrow = panel.querySelector(backwards ? ".el-icon-d-arrow-left" : ".el-icon-d-arrow-right");
      if (!arrow) return false;
      arrow.click();
      await sleep(50);
    }
    const months = [...panel.querySelectorAll(".el-month-table td")].filter(isVisible);
    const targetMonth = months.find(cell => Number(text(cell.innerText).match(/\d{1,2}/)?.[0]) === month && !cell.classList.contains("disabled"));
    if (!targetMonth) return false;
    targetMonth.click();
    await sleep(80);
    if (value.length === 7) return sameDate(input.value, value);
    const days = [...panel.querySelectorAll(".el-date-table td")].filter(cell =>
      isVisible(cell) && !cell.classList.contains("disabled") &&
      !cell.classList.contains("prev-month") && !cell.classList.contains("next-month"));
    const targetDay = days.find(cell => Number(text(cell.innerText).match(/\d{1,2}/)?.[0]) === day);
    if (!targetDay) return false;
    targetDay.click();
    await sleep(100);
    return sameDate(input.value, value);
  }

  async function pickAntDate(input, value) {
    const [year, month] = value.split("-").map(Number);
    let panel = [...document.querySelectorAll(".ant-calendar-picker-container")].find(isVisible);
    if (!panel) {
      input.click();
      await sleep(120);
      panel = [...document.querySelectorAll(".ant-calendar-picker-container")].find(isVisible);
    }
    if (!panel) return false;
    const yearButton = panel.querySelector(".ant-calendar-month-panel-year-select, .ant-calendar-year-select");
    if (!yearButton) return false;
    yearButton.click();
    await sleep(70);
    for (let attempt = 0; attempt < 12; attempt++) {
      const years = [...panel.querySelectorAll(".ant-calendar-year-panel-cell")].filter(isVisible);
      const target = years.find(cell => Number(text(cell.innerText).match(/\d{4}/)?.[0]) === year &&
        !cell.classList.contains("ant-calendar-year-panel-cell-disabled"));
      if (target) { target.click(); break; }
      const values = years.map(cell => Number(text(cell.innerText).match(/\d{4}/)?.[0])).filter(Number.isFinite);
      if (!values.length) return false;
      const backwards = year < Math.min(...values);
      const forwards = year > Math.max(...values);
      if (!backwards && !forwards) return false;
      const arrow = panel.querySelector(backwards ? ".ant-calendar-year-panel-prev-decade-btn" : ".ant-calendar-year-panel-next-decade-btn");
      if (!arrow) return false;
      arrow.click();
      await sleep(50);
    }
    const monthButton = panel.querySelector(".ant-calendar-month-select");
    if (monthButton && ![...panel.querySelectorAll(".ant-calendar-month-panel-cell")].some(isVisible)) {
      monthButton.click();
      await sleep(70);
    }
    const months = [...panel.querySelectorAll(".ant-calendar-month-panel-cell")].filter(isVisible);
    const targetMonth = months.find(cell => Number(text(cell.innerText).match(/\d{1,2}/)?.[0]) === month &&
      !cell.classList.contains("ant-calendar-month-panel-cell-disabled"));
    if (!targetMonth) return false;
    targetMonth.click();
    await sleep(70);
    if (value.length === 7) return sameDate(input.value, value);
    const day = [...panel.querySelectorAll(`.ant-calendar-cell[title="${value}"], .ant-calendar-date[title="${value}"]`)]
      .find(cell => isVisible(cell) && !cell.classList.contains("ant-calendar-disabled-cell"));
    if (!day) return false;
    day.click();
    await sleep(100);
    return sameDate(input.value, value);
  }

  async function setDate(input, value) {
    if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(value) || !input || !isVisible(input) || input.disabled) return false;
    const date = value.length === 7 ? `${value}-01` : value;
    const parsed = new Date(`${date}T12:00:00`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) return false;
    if (await pickElementDate(input, value) || await pickAntDate(input, value)) return true;
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const wasReadonly = input.readOnly;
    if (wasReadonly) input.readOnly = false;
    setInput(input, value);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    if (wasReadonly) input.readOnly = true;
    await sleep(100);
    return sameDate(input.value, value);
  }

  async function choose(cell, value) {
    if (!cell || !isVisible(cell)) return false;
    const input = cell.querySelector("input");
    const native = cell.querySelector("select");
    if (native) {
      const option = [...native.options].find(option => text(option.textContent) === text(value));
      if (!option) return false;
      native.value = option.value;
      native.dispatchEvent(new Event("change", { bubbles: true }));
      return native.value === option.value;
    }
    const trigger = input || cell.querySelector("[role=combobox]") || cell;
    trigger.click();
    await sleep(120);
    const selectors = ["[role=option]", ".el-select-dropdown__item", ".el-cascader-node", ".ant-select-item-option", ".ant-select-dropdown-menu-item", ".ivu-select-item", "li"];
    const options = [...document.querySelectorAll(selectors.join(","))]
      .filter(el => isVisible(el) && text(el.innerText) === text(value));
    const option = options.at(-1);
    if (!option) {
      document.activeElement?.blur?.();
      return false;
    }
    option.click();
    await sleep(100);
    return text(cell.innerText).includes(text(value)) || text(input?.value) === text(value);
  }

  async function chooseRadio(cell, value) {
    if (!cell || !["是", "否"].includes(value)) return false;
    const inputs = [...cell.querySelectorAll("input[type=radio]")];
    const wanted = inputs[value === "是" ? 0 : 1];
    const labels = [...cell.querySelectorAll("label")];
    const label = labels.find(el => text(el.innerText) === value);
    if (label) label.click();
    else if (wanted) wanted.click();
    else {
      const leaf = [...cell.querySelectorAll("span, div")].find(el => text(el.innerText) === value &&
        ![...el.children].some(child => text(child.innerText) === value));
      if (!leaf) return false;
      leaf.click();
    }
    await sleep(50);
    const checked = !!wanted?.checked || inputs.some(input => input.checked &&
      text(input.closest("label")?.innerText) === value);
    const selectedLabel = labels.some(el => text(el.innerText) === value &&
      (el.classList.contains("is-checked") || !!el.querySelector("input:checked")));
    return checked || selectedLabel || text(cell.querySelector(".is-checked")?.innerText) === value;
  }

  async function write(key, target, mode = "input") {
    let value = profile[key]?.trim();
    if (!value) return;
    if (key === "申请日期" && value === "今天") {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date());
      const part = kind => parts.find(item => item.type === kind)?.value;
      value = `${part("year")}-${part("month")}-${part("day")}`;
    }
    const success = mode === "select" ? await choose(target, value)
      : mode === "radio" ? await chooseRadio(target, value)
      : mode === "date" ? await setDate(target?.querySelector?.("input") || target, value)
      : setInput(target?.querySelector?.("input:not([type=hidden])") || target, value);
    add(key, success, mode === "date" ? "请手动选月份或日期，并确认 JSON 格式为 YYYY-MM 或 YYYY-MM-DD" : undefined);
  }

  for (const key of ["联系电话", "身份证号", "单位名称", "统一社会信用代码", "开户户行", "银行账号", "开户户名"]) {
    await write(key, topInput(key));
  }
  await write("申请日期", topInput("申请日期"), "date");

  const rowInputs = {
    "姓名": "姓名", "本人证件号码": "证件类型", "学位证书编号": "学位证书编号", "毕业院校": "毕业院校",
    "社保所在单位": "社保所在单位", "社保所在单位统一信用代码": "社保所在单位统一信用代码",
    "北部四镇房屋租赁合同备案登记号": "北部四镇房屋租赁合同备案登记号", "北部四镇租房地址": "北部四镇租房地址"
  };
  for (const [key, label] of Object.entries(rowInputs)) {
    const target = key === "本人证件号码" ? findRow(label)?.lastElementChild : valueCell(label);
    await write(key, target);
  }
  const selects = { "本人证件类型": "证件类型", "学历": "学历", "学位": "学位", "目前社保缴纳地": "目前社保缴纳地", "所属镇": "所属镇" };
  for (const [key, label] of Object.entries(selects)) await write(key, valueCell(label), "select");
  for (const key of ["毕业时间", "参加工作时间"]) await write(key, valueCell(key), "date");

  const radioLabels = {
    "本人配偶及未成年子女是否在京有房": "本人、配偶及未成年子女是否在京有房",
    "本人配偶及未成年子女是否已享受住房保障政策": "本人、配偶及未成年子女是否已享受公租房、房租补贴等保障政策",
    "是否已婚": "是否已婚", "是否有子女": "是否有子女",
    "是否在北部四镇租房": "是否在北部四镇租房（西北旺镇、温泉镇、苏家坨镇、上庄镇）"
  };
  for (const [key, label] of Object.entries(radioLabels)) await write(key, valueCell(label), "radio");

  const family = [
    ["配偶", "配偶姓名（已婚填写）"], ["子女1", "子女姓名（如有）"], ["子女2", "子女姓名（如有）"]
  ];
  for (const [prefix, label] of family) {
    const rows = [...document.querySelectorAll("tr")].filter(row => [...row.children].some(cell => text(cell.innerText) === label));
    const row = rows[prefix === "子女2" ? 1 : 0];
    const cells = row ? [...row.children] : [];
    await write(`${prefix}姓名`, cells[1]);
    await write(`${prefix}证件类型`, cells[3], "select");
    await write(`${prefix}证件号码`, cells[4]);
  }

  return items;
}

function checkDeclaration() {
  if (!isExpectedApplication()) return { ok: false, reason: "当前页面不是对应的申请表。" };
  const compact = value => String(value || "").replace(/\s+/g, "");
  const table = [...document.querySelectorAll("table")].find(el => compact(el.innerText).includes("本人郑重承诺"));
  if (!table) return { ok: false, reason: "未找到申请承诺区域。" };
  const cell = [...table.querySelectorAll("td")].find(el => compact(el.innerText) === "确认");
  if (!cell) return { ok: false, reason: "未找到承诺确认选项。" };
  const label = [...cell.querySelectorAll("label")].find(el => compact(el.innerText) === "确认");
  const input = cell.querySelector("input[type=radio], input[type=checkbox]");
  const selected = () => !!input?.checked ||
    !!cell.querySelector(".is-checked, .ant-radio-checked, .ant-checkbox-checked, [aria-checked=true]");
  if (!selected()) (label || input || cell).click();
  return selected()
    ? { ok: true }
    : { ok: false, reason: "点击后未能确认已勾选，请在网页上手动检查。" };
}
