import os
import re
import subprocess

# Какие папки обрабатывать:
# добавляй сюда новые коллекции по мере необходимости
TARGET_FOLDERS = [
    "_guides",
]

RU = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}

def translit(text: str) -> str:
    text = text.lower()
    text = "".join(RU.get(c, c) for c in text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text

changed = False

for folder in TARGET_FOLDERS:
    if not os.path.isdir(folder):
        continue

    for filename in os.listdir(folder):
        if not filename.endswith(".md"):
            continue

        old_path = os.path.join(folder, filename)
        base_name = filename[:-3]
        new_name = translit(base_name) + ".md"

        if filename != new_name:
            new_path = os.path.join(folder, new_name)

            if os.path.exists(new_path):
                print(f"SKIP: target already exists: {new_path}")
                continue

            print(f"Renaming: {old_path} -> {new_path}")
            os.rename(old_path, new_path)
            subprocess.run(["git", "add", new_path], check=True)
            subprocess.run(["git", "rm", old_path], check=True)
            changed = True

if not changed:
    print("No files to rename")