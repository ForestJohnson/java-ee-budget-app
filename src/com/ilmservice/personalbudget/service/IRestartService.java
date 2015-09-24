package com.ilmservice.personalbudget.service;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;

public interface IRestartService extends AutoCloseable {
	public Transaction getData(int testId);
}
