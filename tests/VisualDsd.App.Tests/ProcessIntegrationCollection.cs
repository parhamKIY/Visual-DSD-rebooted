using Xunit;

namespace VisualDsd.Tests;

// Process deadlines are tested in isolation from CPU-heavy corpus comparisons.
// Tests within this collection still exercise concurrent jobs explicitly.
[CollectionDefinition("Process integration", DisableParallelization = true)]
public sealed class ProcessIntegrationCollection { }
