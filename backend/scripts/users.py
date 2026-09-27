"""Manage Iris accounts from the terminal (for the app's owner).

    make users                          # list every account
    make delete-user EMAIL=a@b.com      # delete an account and ALL its data (asks to confirm)

Accounts are stored locally in backend/data/iris.db (each laptop has its own).
"""

import sys

from app.config import get_settings
from app.db import Database


def main() -> None:
    db = Database(get_settings().database_path)
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"

    if cmd == "list":
        users = db.list_users()
        if not users:
            print("No accounts yet.")
        for u in users:
            print(f"{u['email']:<35} {u['name']:<20} {u['id']}  created {u['created_at']}")
        print(f"\n{len(users)} account(s). Passwords are stored hashed and can't be shown.")
        return

    if cmd == "delete":
        email = (sys.argv[2] if len(sys.argv) > 2 else "").strip().lower()
        user = email and db.get_user_by_email(email)
        if not user:
            sys.exit(f"No account with email {email!r}. Run `make users` to see them.")
        answer = input(
            f"Delete {user['email']} ({user['name']}) and ALL their data? Type 'delete': "
        )
        if answer.strip() != "delete":
            sys.exit("Cancelled.")
        db.delete_user_everything(user["id"])
        print(f"Deleted {user['email']}.")
        return

    sys.exit("Usage: python -m scripts.users [list | delete EMAIL]")


if __name__ == "__main__":
    main()
