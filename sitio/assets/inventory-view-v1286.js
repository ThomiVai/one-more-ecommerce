// ONE MORE V128.6 - Presentación unificada, sin doble fila de SKUs ya vinculados.
// Las filas virtuales tienen cero unidades REGISTRADAS. No crean stock ni movimientos.
const asMoney = v => (v===null || v===undefined || v==='') ? null : Number(v);
// El endpoint admin/catalog incluye también el catálogo base de artículos físicos.
// Los inventoryOnly son SKUs para compras/stock, no variantes de venta independientes.
const publicVariant = p => p && !p.inventoryOnly && p.status !== 'inventory_only'
  && !String(p.id||'').startsWith('combo-') && p.status !== 'hidden' && p.status !== 'draft';
const label = p => [p.brand,p.name,p.size].filter(Boolean).join(' · ').toLocaleLowerCase('es');
export function buildInventoryRows(physicalCatalog,commercialItems,storefrontVariants,links=[]){
  const physicalIds = new Set((physicalCatalog||[]).map(p=>p.id));
  const published = [...(commercialItems||[]),...(storefrontVariants||[])].filter(publicVariant);
  const byId = new Map(published.map(p=>[p.id,p]));
  const linkedByStock = new Map((links||[]).map(l=>[l.stock_id,l.catalog_id]));
  const rows = (physicalCatalog||[]).map(p=>{
    const catalogId = linkedByStock.get(p.id)||p.id;
    const web = byId.get(catalogId);
    return {
      ...p,
      ...(web?{name:web.name,brand:web.brand,size:web.size,price:asMoney(web.price)}:{}),
      physicalId:p.id,
      commercialId:catalogId,
      virtualVariant:false,
      linkedToVariant:!!web && catalogId!==p.id
    };
  });
  const represented = new Set(rows.map(r=>r.commercialId));
  for(const p of published){
    // Doble defensa: un SKU físico nunca debe reaparecer como variante virtual,
    // incluso si un override cambió erróneamente su estado de publicación.
    if(represented.has(p.id) || physicalIds.has(p.id))continue;
    // Evita representar combos y elementos que no son variantes comercializables.
    rows.push({
      ...p,physicalId:null,commercialId:p.id,
      price:asMoney(p.price),
      virtualVariant:true,linkedToVariant:false
    });
    represented.add(p.id);
  }
  rows.sort((a,b)=>label(a).localeCompare(label(b),'es'));
  return rows;
}
