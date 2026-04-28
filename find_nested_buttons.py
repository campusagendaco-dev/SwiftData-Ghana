import os
import re

def find_nested_buttons(directory):
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.tsx'):
                path = os.path.join(root, file)
                with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    # Find all matches where a button tag contains another button tag
                    # This is a simplified check for nesting
                    matches = re.finditer(r'<button[^>]*>(?:(?!</button>).)*?<button', content, re.DOTALL)
                    for match in matches:
                        line_no = content.count('\n', 0, match.start()) + 1
                        print(f"Potential nested button in {path} at line {line_no}")
                        # Print a snippet
                        snippet = content[match.start():match.end() + 20]
                        print(f"Snippet: {snippet}\n")

if __name__ == "__main__":
    find_nested_buttons('src')
