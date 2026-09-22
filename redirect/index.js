// rungs.hijazionline.com is the app's old address. Send every request to the
// same path on bdaudit.hijazionline.com with a permanent (301) redirect, which
// browsers cache, so a returning visitor skips the old host entirely.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'bdaudit.hijazionline.com';
    return Response.redirect(url.toString(), 301);
  },
};
