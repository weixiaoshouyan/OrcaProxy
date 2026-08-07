#!/usr/bin/env python3
"""
Aliyun Spec-Driven Development - API Specification Parser
解析OpenAPI/Swagger规范文件，生成标准化的API描述
"""

import json
import yaml
import argparse
import sys
from pathlib import Path
from typing import Dict, Any, List, Optional


class SpecParser:
    """API规范解析器"""
    
    def __init__(self):
        self.spec_data = None
        self.parsed_endpoints = []
        self.parsed_models = []
    
    def load_spec(self, file_path: str) -> Dict[str, Any]:
        """加载API规范文件"""
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"Spec file not found: {file_path}")
        
        with open(path, 'r', encoding='utf-8') as f:
            if path.suffix in ['.yaml', '.yml']:
                self.spec_data = yaml.safe_load(f)
            elif path.suffix == '.json':
                self.spec_data = json.load(f)
            else:
                raise ValueError(f"Unsupported file format: {path.suffix}")
        
        return self.spec_data
    
    def parse_endpoints(self) -> List[Dict[str, Any]]:
        """解析API端点"""
        if not self.spec_data:
            raise ValueError("No spec data loaded")
        
        endpoints = []
        paths = self.spec_data.get('paths', {})
        
        for path, methods in paths.items():
            for method, details in methods.items():
                if method in ['get', 'post', 'put', 'delete', 'patch']:
                    endpoint = {
                        'path': path,
                        'method': method.upper(),
                        'summary': details.get('summary', ''),
                        'description': details.get('description', ''),
                        'operationId': details.get('operationId', ''),
                        'parameters': self._parse_parameters(details.get('parameters', [])),
                        'requestBody': self._parse_request_body(details.get('requestBody', {})),
                        'responses': self._parse_responses(details.get('responses', {})),
                        'tags': details.get('tags', [])
                    }
                    endpoints.append(endpoint)
        
        self.parsed_endpoints = endpoints
        return endpoints
    
    def _parse_parameters(self, parameters: List[Dict]) -> List[Dict[str, Any]]:
        """解析请求参数"""
        parsed = []
        for param in parameters:
            parsed.append({
                'name': param.get('name', ''),
                'in': param.get('in', ''),
                'description': param.get('description', ''),
                'required': param.get('required', False),
                'schema': param.get('schema', {})
            })
        return parsed
    
    def _parse_request_body(self, request_body: Dict) -> Dict[str, Any]:
        """解析请求体"""
        if not request_body:
            return {}
        
        content = request_body.get('content', {})
        json_content = content.get('application/json', {})
        schema = json_content.get('schema', {})
        
        return {
            'required': request_body.get('required', False),
            'schema': schema,
            'example': json_content.get('example', {})
        }
    
    def _parse_responses(self, responses: Dict) -> Dict[str, Any]:
        """解析响应"""
        parsed = {}
        for status_code, response in responses.items():
            content = response.get('content', {})
            json_content = content.get('application/json', {})
            
            parsed[status_code] = {
                'description': response.get('description', ''),
                'schema': json_content.get('schema', {}),
                'example': json_content.get('example', {})
            }
        
        return parsed
    
    def parse_models(self) -> List[Dict[str, Any]]:
        """解析数据模型"""
        if not self.spec_data:
            raise ValueError("No spec data loaded")
        
        models = []
        schemas = self.spec_data.get('components', {}).get('schemas', {})
        
        for name, schema in schemas.items():
            model = {
                'name': name,
                'type': schema.get('type', 'object'),
                'properties': self._parse_properties(schema.get('properties', {})),
                'required': schema.get('required', []),
                'description': schema.get('description', '')
            }
            models.append(model)
        
        self.parsed_models = models
        return models
    
    def _parse_properties(self, properties: Dict) -> List[Dict[str, Any]]:
        """解析属性"""
        parsed = []
        for name, prop in properties.items():
            parsed.append({
                'name': name,
                'type': prop.get('type', ''),
                'description': prop.get('description', ''),
                'format': prop.get('format', ''),
                'example': prop.get('example', ''),
                'enum': prop.get('enum', [])
            })
        return parsed
    
    def generate_output(self) -> Dict[str, Any]:
        """生成输出"""
        return {
            'info': {
                'title': self.spec_data.get('info', {}).get('title', ''),
                'version': self.spec_data.get('info', {}).get('version', ''),
                'description': self.spec_data.get('info', {}).get('description', '')
            },
            'baseUrl': self._get_base_url(),
            'endpoints': self.parsed_endpoints,
            'models': self.parsed_models
        }
    
    def _get_base_url(self) -> str:
        """获取基础URL"""
        servers = self.spec_data.get('servers', [])
        if servers:
            return servers[0].get('url', '')
        
        # Swagger 2.0
        host = self.spec_data.get('host', '')
        basePath = self.spec_data.get('basePath', '')
        schemes = self.spec_data.get('schemes', ['https'])
        
        if host:
            return f"{schemes[0]}://{host}{basePath}"
        
        return ''


def main():
    parser = argparse.ArgumentParser(description='Parse OpenAPI/Swagger specification')
    parser.add_argument('--input', '-i', required=True, help='Input spec file path')
    parser.add_argument('--output', '-o', required=True, help='Output file path')
    parser.add_argument('--format', '-f', choices=['json', 'yaml'], default='json', help='Output format')
    
    args = parser.parse_args()
    
    try:
        spec_parser = SpecParser()
        spec_parser.load_spec(args.input)
        spec_parser.parse_endpoints()
        spec_parser.parse_models()
        
        output = spec_parser.generate_output()
        
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            if args.format == 'json':
                json.dump(output, f, indent=2, ensure_ascii=False)
            else:
                yaml.dump(output, f, default_flow_style=False, allow_unicode=True)
        
        print(f"Successfully parsed spec file: {args.input}")
        print(f"Output saved to: {args.output}")
        print(f"Endpoints found: {len(output['endpoints'])}")
        print(f"Models found: {len(output['models'])}")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
