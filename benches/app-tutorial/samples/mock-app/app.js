// Demo app behaviour: hash routes and the few interactions the sample flows use.
const show = () => {
  const id = (location.hash || '#welcome').slice(1);
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.dataset.screen === id));
  window.scrollTo(0, 0);
};
window.addEventListener('hashchange', show);
show();

const go = (id) => { location.hash = id; };
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-go]');
  if (target) go(target.dataset.go);
});
document.getElementById('create').addEventListener('click', () => go('setup-1'));
document.getElementById('next-1').addEventListener('click', () => go('setup-2'));
document.getElementById('next-2').addEventListener('click', () => go('ready'));
document.getElementById('go-today').addEventListener('click', () => go('home'));
document.querySelectorAll('.day').forEach((d) => d.addEventListener('click', () => d.setAttribute('aria-pressed', d.getAttribute('aria-pressed') !== 'true')));

// Reminders: the switch opens the options; choosing and saving updates the page.
const sw = document.getElementById('switch');
const save = document.getElementById('save');
const preview = document.getElementById('preview');
const when = { '1 hour before': 'see you at 10:00 today', '1 day before': 'see you tomorrow at 10:00', '2 days before': 'see you on Sunday at 10:00' };
sw.addEventListener('click', () => {
  const on = sw.getAttribute('aria-checked') !== 'true';
  sw.setAttribute('aria-checked', on);
  document.getElementById('options').classList.toggle('on', on);
  save.disabled = !on;
});
document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === c));
  preview.textContent = `Hi Riley, ${when[c.textContent]} at Acme Café. Reply to change your booking.`;
  document.getElementById('saved').hidden = true; save.disabled = false; save.textContent = 'Save';
}));
save.addEventListener('click', () => {
  document.getElementById('saved').hidden = false;
  document.getElementById('reminders-state').textContent = 'On';
  save.disabled = true; save.textContent = 'Saved';
});
