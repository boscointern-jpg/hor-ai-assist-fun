## DEPRECATION NOTE: The application no longer uses Bedrock Flow to orchestrate the model usage, instead
## opting to call the model directly via the InvokeModelCommand in src/index.ts. This resource and its
## associated resources can probably be removed, but that needs to be tested and verified in DEV before
## any of this code is removed!!!
resource "aws_bedrockagent_flow" "ai-text-cleanup-flow" {
  name               = "${local.stack_id}-bedrock-flow"
  execution_role_arn = data.aws_iam_role.stack.arn
  description        = "Flow to clean up input text on Work Orders"

  definition {
    node {
      name = "FlowInputNode"
      type = "Input"

      configuration {
        input {}
      }

      output {
        name = "document"
        type = "Object"
      }
    }

    node {
      name = "Improve_SO_Text"
      type = "Prompt"

      configuration {
        prompt {
          source_configuration {
            inline {
              model_id      = "anthropic.claude-3-5-sonnet-20241022-v2:0"
              template_type = "TEXT"

              inference_configuration {
                text {
                  max_tokens  = 2000
                  temperature = 0.1
                  top_p       = 1.0
                }
              }

              template_configuration {
                text {
                  text = <<-EOT
                  You are helping improve an input field on a service order for vehicle repair shop.
                  The input field that you are helping is: {{inputField}}
                  - maintaining all technical details and accuracy
                  - using proper automotive terminology
                  - be concise with clarity and completeness
                  - maintain a professional tone
                  - return all responses in English
                  - do NOT put the inputField at the beginning of the response
                  Please enhance this input text below: {{inputText}}
                  Return only the enhanced text with no explanation or commentary.
                  EOT
                  input_variable {
                    name = "inputField"
                  }

                  input_variable {
                    name = "inputText"
                  }
                }
              }
            }
          }
        }
      }

      input {
        name       = "inputField"
        type       = "String"
        expression = "$.data.inputField"
      }

      input {
        name       = "inputText"
        type       = "String"
        expression = "$.data.inputText"
      }

      output {
        name = "modelCompletion"
        type = "String"
      }
    }

    node {
      name = "FlowOutputNode"
      type = "Output"

      configuration {
        output {}
      }

      input {
        name       = "document"
        type       = "String"
        expression = "$.data"
      }
    }

    connection {
      name   = "Improve_SO_Text_InputText"
      source = "FlowInputNode"
      target = "Improve_SO_Text"
      type   = "Data"

      configuration {
        data {
          source_output = "document"
          target_input  = "inputText"
        }
      }
    }

    connection {
      name   = "Improve_SO_Text_InputField"
      source = "FlowInputNode"
      target = "Improve_SO_Text"
      type   = "Data"

      configuration {
        data {
          source_output = "document"
          target_input  = "inputField"
        }
      }
    }

    connection {
      name   = "FlowOutputNode_document"
      source = "Improve_SO_Text"
      target = "FlowOutputNode"
      type   = "Data"

      configuration {
        data {
          source_output = "modelCompletion"
          target_input  = "document"
        }
      }
    }
  }
}
