// 'qrcode' ships no type declarations. This ambient declaration lets the
// production build (`next build`) type-check without requiring the optional
// @types/qrcode devDependency to be installed on the deploy server.
declare module "qrcode";
