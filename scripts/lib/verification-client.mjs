export function verificationClient(base) {
  const cookies = new Map();

  async function request(path, options = {}) {
    const { json, ...init } = options;
    const response = await fetch(new URL(path, base), {
      redirect: "manual",
      signal: AbortSignal.timeout(75_000),
      ...init,
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      headers: {
        origin: base,
        cookie: [...cookies].map(([name, value]) => name + "=" + value).join("; "),
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
    });
    for (const entry of response.headers.getSetCookie()) {
      const pair = entry.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }

  async function login(email, password) {
    const { csrfToken } = await (await request("/api/auth/csrf")).json();
    await request("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: base }),
    });
    return (await (await request("/api/auth/session")).json())?.user;
  }

  return { cookies, request, login };
}
