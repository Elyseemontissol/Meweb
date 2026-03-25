(async function () {
  const headerEl = document.getElementById('shared-header');
  const footerEl = document.getElementById('shared-footer');

  if (headerEl) {
    const res = await fetch('assets/header.html');
    headerEl.innerHTML = await res.text();
    // Set aria-current on the nav link matching the current page
    const page = location.pathname.split('/').pop() || 'index.html';
    const link = headerEl.querySelector(`a[href="${page}"]`);
    if (link) link.setAttribute('aria-current', 'page');
  }

  if (footerEl) {
    const res = await fetch('assets/footer.html');
    footerEl.innerHTML = await res.text();
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  }
})();
