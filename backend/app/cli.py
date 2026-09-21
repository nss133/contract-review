"""Local administrator command; credentials are never accepted on command lines."""
import argparse
import getpass
import json
from pathlib import Path

from app.auth.service import create_user
from app.config import Settings
from app.main import create_app
from app.repositories.database import Database


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init-db")
    user = sub.add_parser("create-user")
    user.add_argument("username")
    user.add_argument("--role", choices=["operator", "knowledge_manager", "reviewer", "reader"], default="reviewer")
    export = sub.add_parser("export-openapi")
    export.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.command == "export-openapi":
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(create_app(Settings(environment="test")).openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return
    settings = Settings.from_env()
    if not settings.database_path:
        parser.error("CR_DATABASE_PATH is required")
    db = Database(settings.database_path, settings.database_timeout)
    db.initialize()
    if args.command == "create-user":
        password = getpass.getpass("비밀번호 (12자 이상): ")
        if password != getpass.getpass("비밀번호 확인: "):
            parser.error("비밀번호가 일치하지 않습니다")
        print(create_user(db, args.username, password, args.role))
    else:
        print("Database initialized")


if __name__ == "__main__":
    main()
