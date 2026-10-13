from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import markdown_to_word


class ConvertMarkdownTests(unittest.TestCase):
    def test_existing_output_is_preserved_without_rendering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            input_path = directory / "input.md"
            output_path = directory / "input.docx"
            original_output = b"existing document"
            input_path.write_text("# Input\n", encoding="utf-8")
            output_path.write_bytes(original_output)

            with (
                patch.object(markdown_to_word, "Document") as document,
                patch.object(markdown_to_word, "_convert_blocks") as render,
                self.assertRaisesRegex(FileExistsError, "refusing to overwrite"),
            ):
                markdown_to_word.convert_markdown(input_path, output_path, "mmdc")

            document.assert_not_called()
            render.assert_not_called()
            self.assertEqual(output_path.read_bytes(), original_output)


if __name__ == "__main__":
    unittest.main()