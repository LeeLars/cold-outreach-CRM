function normalizeCity(city) {
  if (!city || typeof city !== 'string') {
    return null;
  }
  
  const trimmed = city.trim();
  if (!trimmed) {
    return null;
  }
  
  return trimmed.split('-').map(part => 
    part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
  ).join('-');
}

module.exports = { normalizeCity };
