-- Una base de datos por microservicio (mismo servidor en desarrollo, mismo RDS en AWS).
-- escolar_identity la crea la imagen de Postgres con POSTGRES_DB.
CREATE DATABASE escolar_academic OWNER escolar;
CREATE DATABASE escolar_billing OWNER escolar;
CREATE DATABASE escolar_wallet OWNER escolar;
