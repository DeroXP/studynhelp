import ast
import logging
import math
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_UNICODE_TRANSLATION = str.maketrans({
    '\u2212': '-',
    '\u2013': '-',
    '\u2014': '-',
    '\u2015': '-',
    '\u00d7': '*',
    '\u2217': '*',
    '\u00b7': '*',
    '\u22c5': '*',
})
_THOUSAND_SEPARATOR_PATTERN = re.compile(r'(?<=\d),(?=\d{3}(?:\D|$))')
_UNDERSCORE_NUMBER_PATTERN = re.compile(r'(?<=\d)_(?=\d)')
_SPACE_REPLACE_PATTERN = re.compile(r'[\u00a0\u2007\u202f]')


@dataclass(frozen=True)
class Token:
    type: str
    value: str


class TI84Calculator:
    """A lightweight calculator engine offering TI-84-style functionality."""

    def __init__(self) -> None:
        self.history: List[Dict[str, Any]] = []
        self._variables: Dict[str, float] = {'Ans': 0.0}
        for code in range(ord('A'), ord('Z') + 1):
            self._variables.setdefault(chr(code), 0.0)

        self._single_arg_functions = {
            'sin': math.sin,
            'cos': math.cos,
            'tan': math.tan,
            'sqrt': math.sqrt,
            'abs': abs,
            'floor': math.floor,
            'ceil': math.ceil,
        }
        self._function_names = set(self._single_arg_functions.keys()) | {'log', 'round', 'pow'}
        self._constants = {'pi': math.pi, 'e': math.e}

    def evaluate(self, expression: str, numeric: bool = True, precision: Optional[int] = None) -> Dict[str, Any]:
        """
        Evaluate an arithmetic expression and record it in the history.

        Args:
            expression: The raw user-entered expression.
            numeric: When True, return numeric results; otherwise return formatted strings.
            precision: Optional decimal precision for rounding the displayed result.

        Returns:
            A dictionary containing keys: input, result, error, timestamp.
        """
        ts = time.time()
        raw = (expression or "").strip()
        if not raw:
            entry = {"input": raw, "result": None, "error": "Empty expression.", "timestamp": ts}
            self.history.append(entry)
            return entry

        try:
            expr = self._normalize_expression(raw)
            # support variable assignment like A=2+3
            if '=' in expr and self._is_assignment(expr):
                name, rhs = expr.split('=', 1)
                name = name.strip().upper()
                value = self._safe_eval(rhs)
                self.set_var(name, value)
                result_value = self._format_result(value, numeric=numeric, precision=precision)
                entry = {"input": raw, "result": result_value, "error": None, "timestamp": ts}
                self.history.append(entry)
                # Ans mirrors last value
                self._variables['Ans'] = float(value)
                return entry

            value = self._safe_eval(expr)
            result_value = self._format_result(value, numeric=numeric, precision=precision)
            entry = {"input": raw, "result": result_value, "error": None, "timestamp": ts}
            self.history.append(entry)
            self._variables['Ans'] = float(value)
            return entry
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("Calculator evaluation error: %s", exc)
            entry = {"input": raw, "result": None, "error": str(exc), "timestamp": ts}
            self.history.append(entry)
            return entry

    def get_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        return self.history[-limit:]

    def clear_history(self) -> None:
        self.history.clear()

    def set_var(self, name: str, value: float) -> None:
        key = name.strip().upper()
        if key == 'ANS' or (len(key) == 1 and key.isalpha() and key in self._variables):
            numeric_value = self._ensure_number(value)
            self._variables['Ans'] = numeric_value if key == 'ANS' else self._variables['Ans']
            self._variables[key if key != 'ANS' else 'Ans'] = numeric_value
        else:
            raise ValueError("Only variables A..Z and Ans are supported.")

    def get_var(self, name: str) -> float:
        key = name.strip().upper()
        if key == 'ANS':
            return float(self._variables['Ans'])
        if len(key) == 1 and key.isalpha() and key in self._variables:
            return float(self._variables[key])
        raise ValueError("Unknown variable. Use A..Z or Ans.")

    # --------- Normalization and Parsing ---------
    def _normalize_expression(self, s: str) -> str:
        s = s.translate(_UNICODE_TRANSLATION)
        s = _SPACE_REPLACE_PATTERN.sub(' ', s)
        s = s.strip()
        # remove thousand separators (1,234 -> 1234)
        s = _THOUSAND_SEPARATOR_PATTERN.sub('', s)
        s = _UNDERSCORE_NUMBER_PATTERN.sub('', s)
        # common mappings
        s = s.replace('^', '**')
        s = s.replace('ln', 'log')
        # insert '*' for implicit multiplication: number/)/variable followed by ( or variable or constant
        s = self._insert_implicit_multiplication(s)
        return s

    def _insert_implicit_multiplication(self, s: str) -> str:
        # number )( -> )*(
        s = re.sub(r"(\d|\))(\s*)(\(|[A-Za-z])", r"\1*\3", s)
        # variable followed by ( or variable/constant
        s = re.sub(r"([A-Za-z])(\s*)(\(|[A-Za-z])", r"\1*\3", s)
        return s

    def _is_assignment(self, expr: str) -> bool:
        parts = expr.split('=', 1)
        if len(parts) != 2:
            return False
        name = parts[0].strip().upper()
        return name == 'ANS' or (len(name) == 1 and name.isalpha())

    # --------- Safe evaluation ---------
    def _safe_eval(self, expr: str) -> float:
        tree = ast.parse(expr, mode='eval')
        return self._eval_node(tree.body)

    def _eval_node(self, node: ast.AST) -> float:
        if isinstance(node, ast.BinOp):
            left = self._eval_node(node.left)
            right = self._eval_node(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.Mod):
                return left % right
            if isinstance(node.op, ast.Pow):
                return left ** right
            if isinstance(node.op, ast.FloorDiv):
                return left // right
            raise ValueError("Unsupported operator")
        if isinstance(node, ast.UnaryOp):
            val = self._eval_node(node.operand)
            if isinstance(node.op, ast.UAdd):
                return +val
            if isinstance(node.op, ast.USub):
                return -val
            raise ValueError("Unsupported unary operator")
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return float(node.value)
            raise ValueError("Only numbers are allowed")
        if isinstance(node, ast.Name):
            name = node.id
            # support constants and variables
            if name in self._constants:
                return float(self._constants[name])
            key = name.upper()
            if key in self._variables:
                return float(self._variables[key])
            raise ValueError(f"Unknown name '{name}'")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Only simple functions are allowed")
            func_name = node.func.id
            args = [self._eval_node(a) for a in node.args]
            if node.keywords:
                raise ValueError("Keyword arguments not allowed")
            return self._eval_function(func_name, args)
        if isinstance(node, ast.Expr):
            return self._eval_node(node.value)
        raise ValueError("Unsupported expression")

    def _eval_function(self, name: str, args: List[float]) -> float:
        name = name.lower()
        if name in self._single_arg_functions:
            if len(args) != 1:
                raise ValueError(f"Function '{name}' expects one argument")
            return self._ensure_number(self._single_arg_functions[name](args[0]))
        if name == 'log':
            if len(args) == 1:
                return self._ensure_number(math.log(args[0]))
            if len(args) == 2:
                return self._ensure_number(math.log(args[0], args[1]))
            raise ValueError("Function 'log' accepts one or two arguments.")
        if name == 'round':
            if len(args) == 1:
                return self._ensure_number(round(args[0]))
            if len(args) == 2:
                digits = int(args[1])
                return self._ensure_number(round(args[0], digits))
            raise ValueError("Function 'round' accepts one or two arguments.")
        if name == 'pow':
            if len(args) != 2:
                raise ValueError("Function 'pow' expects exactly two arguments.")
            base = self._ensure_number(args[0])
            exponent = self._ensure_number(args[1])
            result = math.pow(base, exponent)
            return self._ensure_number(result)
        raise ValueError(f"Unsupported function '{name}'.")

    def _ensure_number(self, value: Any) -> float:
        if isinstance(value, bool):
            raise ValueError("Boolean values are not supported.")
        if isinstance(value, (int, float)):
            numeric_value = float(value)
            if not math.isfinite(numeric_value):
                raise ValueError("Result is not finite.")
            return numeric_value
        raise ValueError("Non-numeric value encountered.")

    def _format_result(self, value: float, numeric: bool, precision: Optional[int]) -> Any:
        numeric_value = float(value)
        if precision is not None:
            numeric_value = round(numeric_value, precision)
        if numeric:
            if numeric_value.is_integer():
                return int(numeric_value)
            return float(numeric_value)
        return self._format_number(numeric_value, precision)

    def _format_number(self, value: float, precision: Optional[int]) -> str:
        if precision is not None:
            formatted = f"{value:.{precision}f}"
            if '.' in formatted:
                formatted = formatted.rstrip('0').rstrip('.')
        else:
            formatted = format(value, '.12g')
        if not formatted:
            formatted = '0'
        if value == 0:
            formatted = '0'
        if formatted == '-0':
            formatted = '0'
        return formatted
