import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default {
  plugins: [
    tailwindcss,
    autoprefixer({
      overrideBrowserslist: ['last 2 versions'],
    }),
    // Custom plugin to remove vendor-prefixed text-size-adjust declarations
    {
      postcssPlugin: 'remove-webkit-text-size-adjust',
      Declaration(decl) {
        if (decl.prop === '-webkit-text-size-adjust' || decl.prop === '-moz-text-size-adjust') {
          decl.remove();
        }
      },
    },
  ],
};
