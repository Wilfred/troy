import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["dist/"] },
  {
    rules: {
      "@typescript-eslint/explicit-function-return-type": "error",
      "init-declarations": ["error", "always"],
      "no-restricted-syntax": [
        "error",
        {
          selector: ":function FunctionDeclaration",
          message:
            "Nested named functions are not allowed. Move the function to the top level.",
        },
      ],
    },
  },
);
