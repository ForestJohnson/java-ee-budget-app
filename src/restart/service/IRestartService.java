package restart.service;

import restart.protobufs.Restart.Test;
import restart.protobufs.Restart.TestOrBuilder;

public interface IRestartService extends AutoCloseable {
	public TestOrBuilder getData(int testId);
}
