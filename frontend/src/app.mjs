import {ApiClient} from './api-client.mjs';

const byId = id => document.getElementById(id);
const status = message => { byId('service-status').textContent = message; };
let api, user = null, accountId = '', reviewId = '', revision = 0, loadSequence = 0, generation = 0;

function activate(name) {
  document.querySelectorAll('.pane').forEach(element => element.classList.toggle('active', element.id === 'pane-' + name));
  document.querySelectorAll('[data-tab]').forEach(element => element.classList.toggle('active', element.dataset.tab === name));
}

function session(value) {
  generation++;
  if (value && accountId && accountId !== value.id) byId('contract-text').value = '';
  if (value) accountId = value.id;
  user = value;
  byId('login-form').hidden = !!value;
  byId('session-tools').hidden = !value;
  byId('session-user').textContent = value ? value.display_name : '';
  byId('server-save-text').disabled = !value || !['reviewer', 'knowledge_manager'].includes(value.role);
  if (!value) {
    reviewId = ''; revision = 0; loadSequence++;
    byId('server-review-list').replaceChildren(new Option('선택하세요', ''));
  }
}

function failed(error) {
  status(error.message);
  if (error.status === 401) session(null); // Keep current text until explicit logout/account change.
}

async function listReviews() {
  const current = generation;
  const result = await api.request('/reviews');
  if (current !== generation || !user) return;
  const select = byId('server-review-list');
  select.replaceChildren(new Option('선택하세요', ''));
  result.reviews.forEach(row => select.add(new Option(row.title || '제목 없는 본문 초안', row.id)));
  select.value = reviewId;
}

async function loadCatalog() {
  const current = generation;
  const result = await api.request('/catalog');
  if (current !== generation || !user) return;
  ['input-type', 'checklist-type'].forEach(id => {
    const select = byId(id);
    if (select) {
      select.replaceChildren(new Option('계약 유형', ''));
      result.types.forEach(type => select.add(new Option(type.meta.type_name, type.meta.type_id)));
    }
  });
}

// The foundation is not the finished migration. Unsupported actions stay disabled;
// no legacy engine, fixtures or fake analysis results are used in this application.
document.querySelectorAll('main button, main input, main select').forEach(element => {
  if (!element.closest('.server-session')) element.disabled = true;
});
document.querySelectorAll('[data-tab]').forEach(element => element.addEventListener('click', () => activate(element.dataset.tab)));
byId('btn-analyze').title = '계약 분석 기능 준비 중';

byId('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  byId('login-submit').disabled = true;
  try {
    const next = await api.login(byId('login-username').value, byId('login-password').value);
    session(next);
    await Promise.all([listReviews(), loadCatalog()]);
    status('로그인했습니다. 본문 초안을 저장할 수 있습니다. 계약 분석 기능은 준비 중입니다.');
  } catch (error) { failed(error); }
  finally { byId('login-password').value = ''; byId('login-submit').disabled = false; }
});

byId('session-logout').addEventListener('click', async () => {
  try {
    await api.logout();
    byId('contract-text').value = ''; session(null); status('로그아웃했습니다.');
  } catch (error) { failed(error); }
});

byId('server-save-text').addEventListener('click', async () => {
  const button = byId('server-save-text');
  button.disabled = true;
  byId('server-review-list').disabled = true;
  const current = generation;
  const text = byId('contract-text').value;
  try {
    const result = await api.request(reviewId ? '/reviews/' + reviewId : '/reviews', {
      method: reviewId ? 'PATCH' : 'POST', body: {text, title: Array.from(text.split(/\r?\n/)[0]).slice(0, 250).join(''), revision}
    });
    if (current !== generation || !user) return;
    reviewId = result.review_id || reviewId; revision = result.revision;
    await listReviews();
    status(byId('contract-text').value === text ? '본문 초안을 저장했습니다.' : '저장 후 추가 입력이 있습니다. 다시 저장하세요.');
  } catch (error) { failed(error); }
  finally {
    button.disabled = !user || !['reviewer', 'knowledge_manager'].includes(user.role);
    byId('server-review-list').disabled = false;
  }
});

byId('server-review-list').addEventListener('change', async event => {
  const id = event.target.value, sequence = ++loadSequence;
  if (!id) return;
  try {
    const result = await api.request('/reviews/' + id);
    if (sequence !== loadSequence || !user) return;
    reviewId = id; revision = result.review.revision;
    byId('contract-text').value = result.review.text;
    activate('input'); status('저장한 본문 초안을 불러왔습니다.');
  } catch (error) { failed(error); }
});

try {
  const config = await fetch('./config.json', {cache: 'no-store'}).then(response => response.json());
  api = new ApiClient(config.apiBase);
  const current = await api.me();
  session(current); await Promise.all([listReviews(), loadCatalog()]);
  status('로그인 상태입니다. 계약 분석 기능은 준비 중입니다.');
} catch (error) {
  session(null);
  if (error.status !== 401) failed(error);
}
