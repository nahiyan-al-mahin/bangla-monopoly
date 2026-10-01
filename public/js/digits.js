// public/js/digits.js
// "বাংলা সংখ্যা" switch (SPEC §9): show all numbers on screen in Bengali
// digits (০-৯). Display only: the server, the data and the inputs keep
// English digits. Default off; the choice is saved in localStorage.
//
// How it works: while the switch is on, every text that appears on the
// page has its digits converted (a MutationObserver watches for new or
// changed text). Turning it off reloads the page to show English digits.

const DIGITS_KEY = 'bm.banglaDigits';
const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

function banglaDigitsOn() {
  try {
    return localStorage.getItem(DIGITS_KEY) === 'on';
  } catch (err) {
    return false;
  }
}

// "৳1500" -> "৳১৫০০"
function toBanglaDigits(text) {
  return String(text).replace(/[0-9]/g, (d) => BANGLA_DIGITS[Number(d)]);
}

// Convert the digits of every text node under "root".
// Text inside <input>, <textarea>, <script>, <style> is left alone.
function convertDigitsIn(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    convertTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    convertTextNode(node);
    node = walker.nextNode();
  }
}

function convertTextNode(node) {
  const parent = node.parentElement;
  if (!parent || parent.closest('script, style, textarea')) return;
  if (!/[0-9]/.test(node.nodeValue)) return;
  node.nodeValue = toBanglaDigits(node.nodeValue); // no more ASCII digits: no loop
}

let digitsObserver = null;

function startBanglaDigits() {
  convertDigitsIn(document.body);
  if (digitsObserver) return;
  digitsObserver = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      if (m.type === 'characterData') convertTextNode(m.target);
      m.addedNodes.forEach((n) => convertDigitsIn(n));
    });
  });
  digitsObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function setBanglaDigits(on) {
  try {
    localStorage.setItem(DIGITS_KEY, on ? 'on' : 'off');
  } catch (err) {
    // not saved, still applied for this page
  }
  if (on) startBanglaDigits();
  else location.reload(); // simplest way back to English digits
}

// Hook up a checkbox (if the page has one) and apply the saved choice.
function setupDigitsToggle(checkbox) {
  if (checkbox) {
    checkbox.checked = banglaDigitsOn();
    checkbox.addEventListener('change', () => setBanglaDigits(checkbox.checked));
  }
  if (banglaDigitsOn()) startBanglaDigits();
}
