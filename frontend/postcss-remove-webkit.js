/**
 * PostCSS plugin to remove -webkit-text-size-adjust and -moz-text-size-adjust
 * These prefixes are not needed for modern browsers and cause console warnings
 */
export default {
  postcssPlugin: 'remove-webkit-text-size-adjust',
  Once(root) {
    root.walkDecls((decl) => {
      if (decl.prop === '-webkit-text-size-adjust' || decl.prop === '-moz-text-size-adjust') {
        decl.remove();
      }
    });
  },
};
