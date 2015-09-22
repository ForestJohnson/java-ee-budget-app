package restart.service;

import restart.protobufs.Restart.Test;

public interface IRestartService extends AutoCloseable {
	public Test getData();
}
