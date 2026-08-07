---
name: "Aliyun Spec-Driven Development"
description: "阿里云规范驱动开发工具 - 基于OpenAPI规范自动生成代码、测试和文档"
---

# Aliyun Spec-Driven Development

阿里云规范驱动开发工具，基于OpenAPI/Swagger规范自动生成代码、测试和文档。

## 功能特性

### 1. API规范解析
- 支持OpenAPI 3.0/Swagger 2.0规范
- 自动解析API端点、请求/响应模型
- 支持JSON/YAML格式的规范文件

### 2. 代码生成
- 自动生成TypeScript/JavaScript客户端代码
- 自动生成Python SDK代码
- 自动生成Java客户端代码
- 支持自定义代码模板

### 3. 测试生成
- 自动生成单元测试代码
- 自动生成集成测试代码
- 自动生成API测试用例
- 支持Mock数据生成

### 4. 文档生成
- 自动生成API文档
- 自动生成SDK使用文档
- 支持Markdown/HTML格式输出
- 支持多语言文档

## 使用方法

### 1. 解析API规范
```bash
# 解析OpenAPI规范文件
python scripts/parse_spec.py --input api-spec.yaml --output parsed.json
```

### 2. 生成客户端代码
```bash
# 生成TypeScript客户端
python scripts/generate_code.py --spec parsed.json --language typescript --output ./generated/ts

# 生成Python客户端
python scripts/generate_code.py --spec parsed.json --language python --output ./generated/python
```

### 3. 生成测试代码
```bash
# 生成单元测试
python scripts/generate_tests.py --spec parsed.json --type unit --output ./tests/unit

# 生成集成测试
python scripts/generate_tests.py --spec parsed.json --type integration --output ./tests/integration
```

### 4. 生成文档
```bash
# 生成Markdown文档
python scripts/generate_docs.py --spec parsed.json --format markdown --output ./docs

# 生成HTML文档
python scripts/generate_docs.py --spec parsed.json --format html --output ./docs/html
```

## 配置说明

### 环境变量
- `ALIYUN_ACCESS_KEY`: 阿里云AccessKey ID
- `ALIYUN_SECRET_KEY`: 阿里云AccessKey Secret
- `ALIYUN_REGION`: 阿里云区域（如cn-hangzhou）

### 配置文件
配置文件位于 `config.json`，包含以下配置项：
```json
{
  "outputDir": "./generated",
  "language": "typescript",
  "templateDir": "./templates",
  "testFramework": "jest",
  "docFormat": "markdown"
}
```

## 支持的阿里云服务

- ECS (云服务器)
- OSS (对象存储)
- RDS (关系型数据库)
- SLB (负载均衡)
- VPC (专有网络)
- CDN (内容分发网络)
- SMS (短信服务)
- DM (邮件推送)

## 示例

### 1. 生成OSS客户端代码
```bash
python scripts/generate_code.py \
  --spec https://oss-cn-hangzhou.aliyuncs.com/openapi.json \
  --language typescript \
  --output ./oss-client
```

### 2. 生成ECS测试代码
```bash
python scripts/generate_tests.py \
  --spec ecs-spec.yaml \
  --type unit \
  --output ./ecs-tests
```

## 注意事项

1. 确保有足够的权限访问阿里云API
2. 生成的代码可能需要根据实际需求进行调整
3. 建议在生成代码后进行代码审查
4. 定期更新API规范以获取最新功能

## 故障排除

### 常见问题

**Q: 解析规范文件失败**
A: 检查规范文件格式是否正确，确保是有效的OpenAPI/Swagger规范

**Q: 生成的代码有语法错误**
A: 检查模板文件是否正确，确保语言版本兼容

**Q: 测试生成失败**
A: 检查规范文件中的示例数据是否完整

## 更新日志

### v1.0.0
- 初始版本发布
- 支持OpenAPI 3.0规范解析
- 支持TypeScript/Python代码生成
- 支持单元测试生成
- 支持Markdown文档生成
