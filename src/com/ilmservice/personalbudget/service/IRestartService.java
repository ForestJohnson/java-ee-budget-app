package com.ilmservice.personalbudget.service;

import com.ilmservice.personalbudget.protobufs.Restart.Test;
import com.ilmservice.personalbudget.protobufs.Restart.TestOrBuilder;

public interface IRestartService extends AutoCloseable {
	public TestOrBuilder getData(int testId);
}
