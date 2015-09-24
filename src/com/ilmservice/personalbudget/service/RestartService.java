package com.ilmservice.personalbudget.service;

import java.nio.ByteBuffer;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import com.google.protobuf.InvalidProtocolBufferException;
import com.ilmservice.personalbudget.data.IProtobufRepository;
import com.ilmservice.personalbudget.data.IProtobufRepository.IProtobufIndex;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;

@Default
@Stateless
public class RestartService implements IRestartService {

	@Inject private IProtobufRepository<Transaction> tests;
	private IProtobufIndex<Integer, Transaction> testById;
	
	@PostConstruct
	public void configure() {
		tests.configure( 
			(x) -> {
				try {
					return Transaction.parseFrom(x);
				} catch (InvalidProtocolBufferException ex){
					return Transaction.newBuilder().build();
				}
			}
		);
		
		testById = tests.configureIndex(
			"id",
			(k) -> Transaction.newBuilder().setTransactionId(k).build(),
			(v) -> v.getTransactionId(),
			(k) -> ByteBuffer.allocate(4).putInt(k).array()
		);
	}
	
	@Override
	public Transaction getData(int testId) {
		Transaction test = testById.query().atKey(testId).firstOrDefault();
		
		test = tests.put(Transaction.newBuilder(test).setDescription(test.getDescription()+" :) ").build());
		
		return test;
	}
	
	@Override
	public void close() throws Exception {
		// TODO Auto-generated method stub

	}
}
