export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || '서버에 연결할 수 없습니다. 입력을 유지하고 다시 시도하세요.');
    this.status = status;
    this.code = body?.error?.code || 'network_error';
    this.requestId = body?.request_id || '';
    this.retryable = body?.error?.retryable === true || status === 0;
  }
}

export class ApiClient {
  constructor(base, transport = globalThis.fetch.bind(globalThis)) {
    this.base = base.replace(/\/$/, '');
    this.transport = transport;
    this.csrfToken = '';
  }

  async request(path, {method = 'GET', body, form, signal} = {}) {
    const headers = {Accept: 'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    let response;
    try {
      response = await this.transport(this.base + path, {method, headers, credentials: 'include',
        cache: 'no-store', signal, ...(form ? {body:form} : body !== undefined ? {body: JSON.stringify(body)} : {})});
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new ApiError(0, null);
    }
    let value;
    try { value = await response.json(); } catch { throw new ApiError(response.status, null); }
    if (!response.ok) {
      if (response.status === 401) this.csrfToken = '';
      throw new ApiError(response.status, value);
    }
    if (value.api_version !== '1') throw new ApiError(409, {error: {code: 'api_version_mismatch', message: '앱과 서버의 버전이 맞지 않습니다. 새로고침하세요.'}});
    return value;
  }

  async login(username, password) {
    const value = await this.request('/auth/login', {method: 'POST', body: {username, password}});
    this.csrfToken = value.csrf_token;
    return value.user;
  }

  async me() {
    const value = await this.request('/me');
    this.csrfToken = value.csrf_token;
    return value.user;
  }

  async logout() {
    await this.request('/auth/logout', {method: 'POST'});
    this.csrfToken = '';
  }
}
