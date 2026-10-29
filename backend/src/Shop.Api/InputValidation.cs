using System.Collections;
using System.Reflection;
using Shop.SharedKernel;

public static class InputValidation
{
    public static ValueTask<object?> Filter(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        foreach (var argument in context.Arguments.Where(a => a is not null && IsInput(a.GetType()))) Validate(argument!, 0);
        return next(context);
    }
    private static bool IsInput(Type type) => type.Name.EndsWith("Input", StringComparison.Ordinal) || type.Name is "PasswordLogin" or "MfaVerification" or "StockAdjustment";
    private static void Validate(object value, int depth)
    {
        if (depth > 12) throw new BusinessException("invalid_input", "Input nesting is too deep.");
        var nullability = new NullabilityInfoContext();
        foreach (var property in value.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            var item = property.GetValue(value);
            if (item is null) { if (nullability.Create(property).ReadState == NullabilityState.NotNull) throw new BusinessException("invalid_input", $"A value is required for {property.Name}."); continue; }
            if (item is string text) { if (text.Length > 8000) throw new BusinessException("invalid_input", $"The value for {property.Name} is too long."); }
            else if (item is Array list) {
                if (list.Length > 500) throw new BusinessException("invalid_input", $"Too many values for {property.Name}.");
                foreach (var child in list) { if (child is null) throw new BusinessException("invalid_input", "Array elements cannot be null."); if (IsInput(child.GetType())) Validate(child, depth + 1); }
            }
            else if (IsInput(item.GetType())) Validate(item, depth + 1);
        }
    }
}
