namespace Shop.Modules.Catalog.Application;

public sealed class ProductFieldValidationException(Dictionary<string, string[]> errors) : Exception("Product fields need correction.")
{
    public IReadOnlyDictionary<string, string[]> Errors { get; } = errors;
}
