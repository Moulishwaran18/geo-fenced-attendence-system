export function renderErrorPage(error?: any): string {
  const errorMessage = error?.message || (typeof error === "string" ? error : "");
  const errorStack = error?.stack || "";
  const errorDetails = errorMessage
    ? `<div style="margin-top:1rem;padding:0.75rem;background:#fee2e2;border:1px solid #f87171;border-radius:0.375rem;text-align:left;font-family:monospace;font-size:12px;color:#991b1b;word-break:break-all;">
        <b>${error?.name || "Error"}:</b> ${errorMessage}
        ${errorStack ? `<pre style="margin-top:0.5rem;max-height:150px;overflow:auto;background:#18181b;color:#f4f4f5;padding:0.5rem;border-radius:0.25rem;font-size:10px;">${errorStack}</pre>` : ""}
      </div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; margin-top: 1rem; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #2563eb; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      ${errorDetails}
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}
