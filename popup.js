"use strict";

const EXPECTED_KEYS = new Set([
  "联系电话", "身份证号", "单位名称", "统一社会信用代码", "开户户行", "银行账号", "开户户名", "申请日期",
  "姓名", "本人证件类型", "本人证件号码", "学历", "学位", "学位证书编号", "毕业院校", "毕业时间", "参加工作时间",
  "目前社保缴纳地", "社保所在单位", "社保所在单位统一信用代码", "本人配偶及未成年子女是否在京有房",
  "本人配偶及未成年子女是否已享受住房保障政策", "是否已婚", "是否有子女", "配偶姓名", "配偶证件类型",
  "配偶证件号码", "子女1姓名", "子女1证件类型", "子女1证件号码", "子女2姓名", "子女2证件类型",
  "子女2证件号码", "是否在北部四镇租房", "北部四镇房屋租赁合同备案登记号", "北部四镇租房地址", "所属镇"
]);
const input = document.getElementById("profile");
const chooseButton = document.getElementById("choose");
const button = document.getElementById("fill");
const confirmButton = document.getElementById("confirm");
const rememberButton = document.getElementById("remember");
const forgetButton = document.getElementById("forget");
const status = document.getElementById("status");
const results = document.getElementById("results");
let profile = null;
let defaultHandle = null;
let recentHandle = null;
let source = null;
let profileName = null;

function setStatus(message, className = "muted") {
  status.className = className;
  status.textContent = message;
}

function parseProfile(contents) {
  const parsed = JSON.parse(contents);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("文件顶层必须是一个 JSON 对象。");
  const unknown = Object.keys(parsed).filter(key => !EXPECTED_KEYS.has(key));
  if (unknown.length) throw new Error(`未知字段：${unknown.join("、")}`);
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") throw new Error(`${key} 必须填写为字符串。`);
  }
  return parsed;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("monthly-form-helper", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storedHandle(action, value, key = "defaultFile") {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("settings", action === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("settings");
      let result;
      const request = action === "get" ? store.get(key)
        : action === "put" ? store.put(value, key) : store.delete(key);
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("数据库操作已取消"));
    });
  } finally {
    db.close();
  }
}

function updateButtons() {
  button.disabled = !(source === "temporary" && profile) && !defaultHandle;
  forgetButton.hidden = !defaultHandle;
}

async function applicationTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let pageUrl;
  try { pageUrl = new URL(tab?.url || ""); } catch { /* handled below */ }
  if (!tab?.id || pageUrl?.protocol !== "https:" || pageUrl?.hostname !== "zhengce.beijing.gov.cn") {
    const host = pageUrl?.hostname || "无法读取网址";
    throw new Error(`当前标签页不在北京市政策兑现网站（识别到：${host}）。`);
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  const detection = await chrome.tabs.sendMessage(tab.id, { type: "CHECK_APPLICATION" });
  if (!detection?.ok) throw new Error("当前页面没有找到“2026年海淀区青年人才安居补贴（申请人）”的完整基本信息表。请打开表单并等待加载完成。");
  return tab;
}

Promise.all([storedHandle("get"), storedHandle("get", undefined, "recentFile")]).then(([handle, recent]) => {
  defaultHandle = handle || null;
  recentHandle = recent || null;
  if (defaultHandle && source !== "temporary") {
    source = "default";
    profileName = defaultHandle.name;
    setStatus(`默认文件：${defaultHandle.name}。点击填写时重新读取，修改文件后无需重新设定。`);
  }
  updateButtons();
}).catch(error => setStatus(`无法读取文件设置：${error.message}`, "error"));

function pickerOptions() {
  return {
    id: "housing-profile",
    multiple: false,
    startIn: defaultHandle || recentHandle || "desktop",
    types: [{ description: "JSON 资料文件", accept: { "application/json": [".json"] } }]
  };
}

async function selectTemporary(file, handle) {
  const parsed = parseProfile(await file.text());
  if (handle) {
    await storedHandle("put", handle, "recentFile");
    recentHandle = handle;
  }
  profile = parsed;
  source = "temporary";
  profileName = file.name;
  results.replaceChildren();
  updateButtons();
  setStatus(`本次使用：${file.name}（${Object.values(parsed).filter(v => v.trim()).length} 个非空字段）。`, "ok");
}

rememberButton.addEventListener("click", async () => {
  try {
    if (!window.showOpenFilePicker) throw new Error("此 Chrome 不支持记住文件，请继续使用下方的临时选择。");
    const [handle] = await window.showOpenFilePicker(pickerOptions());
    const parsed = parseProfile(await (await handle.getFile()).text());
    await storedHandle("put", handle);
    await storedHandle("put", handle, "recentFile");
    defaultHandle = handle;
    recentHandle = handle;
    profile = parsed;
    source = "default";
    profileName = handle.name;
    input.value = "";
    results.replaceChildren();
    updateButtons();
    setStatus(`已设为默认：${handle.name}（${Object.values(parsed).filter(v => v.trim()).length} 个非空字段）。扩展只记住文件句柄，不保存资料内容。`, "ok");
  } catch (error) {
    if (error.name !== "AbortError") setStatus(`设置默认文件失败：${error.message}`, "error");
  }
});

forgetButton.addEventListener("click", async () => {
  try {
    await storedHandle("delete");
    defaultHandle = null;
    if (source === "default") { profile = null; source = null; profileName = null; }
    updateButtons();
    setStatus("已取消默认文件。原 JSON 文件没有被删除。", "ok");
  } catch (error) {
    setStatus(`取消失败：${error.message}`, "error");
  }
});

chooseButton.addEventListener("click", async () => {
  if (!window.showOpenFilePicker) {
    input.value = "";
    input.click();
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker(pickerOptions());
    await selectTemporary(await handle.getFile(), handle);
  } catch (error) {
    if (error.name !== "AbortError") setStatus(`选择资料文件失败：${error.message}`, "error");
  }
});

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  try {
    await selectTemporary(file, null);
  } catch (error) {
    setStatus(`资料文件有误：${error.message}`, "error");
  }
});

button.addEventListener("click", async () => {
  if (!profile && !defaultHandle) return;
  button.disabled = true;
  results.replaceChildren();
  setStatus("正在填写，请保持当前申请页打开……");
  try {
    if (source !== "temporary" && defaultHandle) {
      // Permission must be requested directly from the user's click gesture.
      const permission = await defaultHandle.requestPermission({ mode: "read" });
      if (permission !== "granted") throw new Error("未获得默认文件读取权限；可以重新选择 JSON 文件。");
      profile = parseProfile(await (await defaultHandle.getFile()).text());
      source = "default";
      profileName = defaultHandle.name;
    }
    if (!profile) throw new Error("请先选择资料文件。");
    const tab = await applicationTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FILL_APPLICATION", profile });
    if (!response || !Array.isArray(response.items)) throw new Error("网页没有返回填写结果，请刷新申请页后重试。");
    const done = response.items.filter(item => item.status === "done").length;
    const remaining = response.items.filter(item => item.status !== "done");
    setStatus(`本次读取：${profileName || "JSON 文件"}。已填写 ${done} 项；${remaining.length} 项需要手动处理。页面顶部“申报主体”由登录账号带出。请核对网页内容，附件和最终提交由你完成。`, remaining.length ? "warn" : "ok");
    for (const item of remaining) {
      const li = document.createElement("li");
      li.textContent = `${item.key}：${item.reason}`;
      results.append(li);
    }
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    updateButtons();
  }
});

confirmButton.addEventListener("click", async () => {
  confirmButton.disabled = true;
  results.replaceChildren();
  setStatus("正在勾选页面承诺……");
  try {
    const tab = await applicationTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "CONFIRM_DECLARATION" });
    if (!response?.ok) throw new Error(response?.reason || "未找到承诺确认控件，请在网页上手动勾选。");
    setStatus("已勾选页面承诺。请继续核对页面，并由你决定是否提交。", "ok");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    confirmButton.disabled = false;
  }
});
