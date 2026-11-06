-- ONE MORE V125: archivado reversible de items del inventario.
-- Solo preproduccion: ejecutar una vez en D1 YOUR_D1_DATABASE_NAME.
CREATE TABLE IF NOT EXISTS inventory_archived (
 product_id TEXT PRIMARY KEY,
 archived_at TEXT NOT NULL DEFAULT (datetime('now')),
 reason TEXT NOT NULL DEFAULT 'Ocultado del listado'
);
