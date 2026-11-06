-- V117: vínculo único entre una venta y un pedido, sin borrar tablas existentes.
ALTER TABLE sales ADD COLUMN order_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sales_order_id_unique ON sales(order_id) WHERE order_id IS NOT NULL;
-- El sistema anterior usa la columna status; la venta confirmada enlazada actualiza el pedido.
-- Ejecutar ALTER TABLE una sola vez. Si order_id ya existe, NO repetir el ALTER.
