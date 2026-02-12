function errorHandler(err, req, res, next) {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Er is iets misgegaan'
  });
}

module.exports = { errorHandler };
