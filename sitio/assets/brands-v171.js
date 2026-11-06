// Las marcas salen del catálogo recibido; accesorios no es una marca.
const known = [
  ['STAR NUTRITION', 'STAR', 'NUTRITION'], ['ENA SPORT', 'ENA', 'SPORT'],
  ['GENTECH', 'GENTECH', 'ARGENTINA'], ['BODY ADVANCE', 'BODY', 'ADVANCE'],
  ['GOLD NUTRITION', 'GOLD', 'NUTRITION'], ['XTRENGHT', 'XTRENGHT', 'NUTRITION'],
  ['ULTRA TECH', 'ULTRA', 'TECH'],
];
export function catalogBrands(products) {
  const names = new Set(products.map(p => String(p.brand || '').trim().toUpperCase())
    .filter(b => b && !['ACCESORIOS','SIN MARCA','OTROS'].includes(b))
    .map(b => b === 'ENA' ? 'ENA SPORT' : b));
  return [...known.filter(([id]) => names.has(id)),
    ...[...names].filter(id => !known.some(([key]) => key === id)).sort().map(id => [id,id,''])];
}
export function createBrands(React, products) {
  const h = React.createElement;
  const brands = catalogBrands(products);
  return function Brands() {
    if (!brands.length) return null;
    const group = duplicate => h('div', {
      className:'om146-brand-group', key:String(duplicate), 'aria-hidden':duplicate ? true : undefined,
    }, brands.map(([id, title, sub]) => h('b', {key:id, className:'om146-wordmark'},
      title, sub && h('small',null,sub))));
    return h('div', {className:'brands-intro om146-brands',
      role:'region', 'aria-label':'Marcas del catálogo'},
      h('div',{className:'om146-brands-caption'},
        h('span',null,'MARCAS QUE ENCONTRÁS EN ONE MORE')),
      h('div',{className:'om146-brand-window'},
        h('div',{className:'om146-brand-track'},group(false),group(true))));
  };
}
