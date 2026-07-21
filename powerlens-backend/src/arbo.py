import os
import sys

# Pour éviter les problèmes d'encodage sous Windows
sys.stdout.reconfigure(encoding="utf-8")

IGNORED_DIRS = {".git", "__pycache__", "node_modules", ".venv"}

def afficher_arborescence(racine, prefix=""):
    try:
        elements = sorted(os.listdir(racine))
    except PermissionError:
        print(prefix + "└── [Accès refusé]")
        return

    elements = [e for e in elements if e not in IGNORED_DIRS]

    for index, element in enumerate(elements):
        chemin = os.path.join(racine, element)
        est_dernier = index == len(elements) - 1

        branche = "└── " if est_dernier else "├── "
        print(prefix + branche + element + ("/" if os.path.isdir(chemin) else ""))

        if os.path.isdir(chemin):
            extension = "    " if est_dernier else "│   "
            afficher_arborescence(chemin, prefix + extension)

if __name__ == "__main__":
    racine = os.getcwd()
    print(os.path.basename(racine) + "/")
    afficher_arborescence(racine)
