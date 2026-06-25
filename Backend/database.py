import os
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

load_dotenv()

def get_connection():
    return psycopg.connect(os.getenv('DATABASE_URL'), row_factory=dict_row)


def init_db():
    conn = get_connection()
    cur  = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id                 SERIAL        PRIMARY KEY,
            email              VARCHAR(255)  UNIQUE NOT NULL,
            password_hash      VARCHAR(255),
            name               VARCHAR(255),
            avatar_url         TEXT,
            provider           VARCHAR(50)   DEFAULT 'email',
            provider_id        VARCHAR(255),
            steam_api_key      VARCHAR(255),
            steam_id           VARCHAR(50),
            gemini_api_key     VARCHAR(255),
            two_factor_secret  VARCHAR(255),
            two_factor_enabled BOOLEAN       DEFAULT FALSE,
            reset_token        VARCHAR(255),
            reset_expires      TIMESTAMP,
            created_at         TIMESTAMP     DEFAULT NOW(),
            updated_at         TIMESTAMP     DEFAULT NOW()
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS guide_cache (
            appid        VARCHAR(20)  PRIMARY KEY,
            game_name    VARCHAR(255),
            html_content TEXT,
            created_at   TIMESTAMP    DEFAULT NOW(),
            updated_at   TIMESTAMP    DEFAULT NOW()
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id         SERIAL       PRIMARY KEY,
            appid      VARCHAR(20)  NOT NULL,
            game_name  VARCHAR(255),
            title      VARCHAR(255) DEFAULT 'Anotação',
            content    TEXT,
            created_at TIMESTAMP    DEFAULT NOW(),
            updated_at TIMESTAMP    DEFAULT NOW()
        );
    """)

    # Adiciona user_id se não existir ainda
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='notes' AND column_name='user_id'
            ) THEN
                ALTER TABLE notes ADD COLUMN user_id INTEGER;
            END IF;
        END$$;
    """)

    cur.execute("CREATE INDEX IF NOT EXISTS idx_notes_appid ON notes(appid);")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_games (
            id               SERIAL        PRIMARY KEY,
            user_id          INTEGER       REFERENCES users(id) ON DELETE CASCADE,
            appid            VARCHAR(20)   NOT NULL,
            name             VARCHAR(255),
            playtime_forever INTEGER       DEFAULT 0,
            img_icon_url     VARCHAR(255),
            last_synced      TIMESTAMP     DEFAULT NOW(),
            UNIQUE(user_id, appid)
        );
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_ugames_user ON user_games(user_id);")

    # Colunas extras p/ cache de progresso (adiciona se não existirem)
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='user_games' AND column_name='status') THEN
                ALTER TABLE user_games ADD COLUMN status VARCHAR(50) DEFAULT 'Sem Conquistas';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='user_games' AND column_name='pct') THEN
                ALTER TABLE user_games ADD COLUMN pct REAL DEFAULT 0;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='user_games' AND column_name='achievements') THEN
                ALTER TABLE user_games ADD COLUMN achievements JSONB DEFAULT '[]'::jsonb;
            END IF;
        END$$;
    """)

    # Controle de última sincronização por usuário
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sync_status (
            user_id     INTEGER   PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            last_synced TIMESTAMP DEFAULT NOW()
        );
    """)

    conn.commit()
    cur.close()
    conn.close()
    print("[DB] ✅ Tabelas inicializadas com sucesso.")
