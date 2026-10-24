export default {
  paths: ['tests/features/**/*.feature'],
  import: ['tests/steps/**/*.mts'],
  format: [
    'progress',
    'junit:.local/test-results/functional.xml',
    'html:.local/test-results/functional.html',
  ],
  strict: true,
  retry: 0,
};
