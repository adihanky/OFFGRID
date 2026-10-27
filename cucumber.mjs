export default {
  paths: ['tests/features/**/*.feature'],
  import: ['tests/steps/**/*.mts'],
  format: [
    'progress',
    'junit:.local/test-results/functional.xml',
    'html:.local/test-results/functional.html',
    'message:.local/test-results/functional-messages.ndjson',
  ],
  strict: true,
  retry: 0,
};
