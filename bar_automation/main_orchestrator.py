from pathlib import Path
import argparse

import stage1_clean
import stage2_extract
import stage3_logic


def run_pipeline(file_path: str) -> list[dict]:
    print('Cleaning image...')
    clean_img = stage1_clean.preprocess(file_path)

    print('Extracting data...')
    raw_json = stage2_extract.get_data(clean_img)

    print('Applying business rules...')
    final_data = stage3_logic.apply_rules(raw_json)

    print('Pipeline Complete.')
    return final_data


def main() -> None:
    parser = argparse.ArgumentParser(description='Run the bar automation pipeline.')
    parser.add_argument('input_file', help='Path to the image or PDF in the inbox folder.')
    parser.add_argument('--save-json', help='Optional path to save final JSON output.')
    args = parser.parse_args()

    input_path = Path(args.input_file)
    if not input_path.exists():
        raise FileNotFoundError(f'Input file does not exist: {input_path}')

    final_data = run_pipeline(str(input_path))

    if args.save_json:
        import json
        output_path = Path(args.save_json)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(final_data, indent=2), encoding='utf-8')
        print(f'Saved output to: {output_path}')
    else:
        import json
        print(json.dumps(final_data, ensure_ascii=False))


if __name__ == '__main__':
    main()
