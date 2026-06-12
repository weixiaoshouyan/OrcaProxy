import sys
import os

def convert_png_to_ico(png_path, ico_path):
    try:
        from PIL import Image
        print("Pillow is installed. Converting...")
        img = Image.open(png_path)
        # Resize to standard icon sizes and save
        img.save(ico_path, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
        print(f"Icon saved successfully at {ico_path}")
        return True
    except ImportError:
        print("Pillow not found. Trying fallback converting method using standard library or simple resizing...")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python convert_icon.py <png_path> <ico_path>")
        sys.exit(1)
    convert_png_to_ico(sys.argv[1], sys.argv[2])
