import json
import os

def main():
    log_file = r"C:\Users\Yoganshu Sharma\.gemini\antigravity-ide\brain\2d11741a-fa54-4c1d-99c8-3f1438412001\.system_generated\logs\transcript.jsonl"
    if not os.path.exists(log_file):
        print(f"Log file not found at: {log_file}")
        return
        
    print(f"Reading log: {log_file}")
    with open(log_file, "r", encoding="utf-8") as f:
        for line in f:
            try:
                data = json.loads(line)
                content = data.get("content", "")
                if "hotspot" in content.lower() or "dms" in content.lower() or "ipynb" in content.lower() or "write_to_file" in str(data).lower():
                    # Print step details
                    print(f"Step {data.get('step_index')}: {data.get('type')} - {data.get('status')}")
                    # Print tool calls
                    tool_calls = data.get("tool_calls", [])
                    for tc in tool_calls:
                        print(f"  Tool: {tc.get('name')}")
                        args = tc.get("args", {})
                        if "TargetFile" in args:
                            print(f"    TargetFile: {args['TargetFile']}")
            except Exception as e:
                pass

if __name__ == "__main__":
    main()
